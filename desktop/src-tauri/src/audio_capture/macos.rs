//! AVAudioEngine capture. The tap runs on Core Audio's thread; every send goes
//! through one locked sink, so `stop` can append the flush marker after the last
//! chunk and later callbacks are dropped.
use super::{choose_device, mono_bytes, NativeCaptureStarted, NativeCaptureStopped};
use block2::RcBlock;
use core_foundation::{
    base::TCFType,
    string::{CFString, CFStringRef},
};
use objc2::{
    class, msg_send,
    rc::autoreleasepool,
    runtime::{AnyObject, Bool},
};
use std::{
    ffi::c_void,
    ptr,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    time::Duration,
};
use tauri::ipc::{Channel, InvokeResponseBody};

type AudioObjectId = u32;
type Sink = Arc<Mutex<Option<Channel<InvokeResponseBody>>>>;

#[repr(C)]
struct PropertyAddress {
    selector: u32,
    scope: u32,
    element: u32,
}

const fn code(value: &[u8; 4]) -> u32 {
    u32::from_be_bytes(*value)
}
const SYSTEM_OBJECT: AudioObjectId = 1;
const DEVICES: u32 = code(b"dev#");
const DEFAULT_INPUT: u32 = code(b"dIn ");
const STREAMS: u32 = code(b"stm#");
const NAME: u32 = code(b"lnam");
const SCOPE_GLOBAL: u32 = code(b"glob");
const SCOPE_INPUT: u32 = code(b"inpt");
// kAudioOutputUnitProperty_CurrentDevice on kAudioUnitScope_Global.
const CURRENT_DEVICE: u32 = 2000;
const BUFFER_FRAMES: u32 = 4096;
const AUTHORIZED: isize = 3;
const NOT_DETERMINED: isize = 0;

#[link(name = "CoreAudio", kind = "framework")]
extern "C" {
    fn AudioObjectGetPropertyDataSize(
        object: AudioObjectId,
        address: *const PropertyAddress,
        qualifier_size: u32,
        qualifier: *const c_void,
        size: *mut u32,
    ) -> i32;
    fn AudioObjectGetPropertyData(
        object: AudioObjectId,
        address: *const PropertyAddress,
        qualifier_size: u32,
        qualifier: *const c_void,
        size: *mut u32,
        data: *mut c_void,
    ) -> i32;
}
#[link(name = "AudioToolbox", kind = "framework")]
extern "C" {
    fn AudioUnitSetProperty(
        unit: *mut c_void,
        property: u32,
        scope: u32,
        element: u32,
        data: *const c_void,
        size: u32,
    ) -> i32;
}
#[link(name = "AVFAudio", kind = "framework")]
extern "C" {
    static AVAudioEngineConfigurationChangeNotification: *const AnyObject;
}
#[link(name = "AVFoundation", kind = "framework")]
extern "C" {
    static AVMediaTypeAudio: *const AnyObject;
}

struct Capture {
    engine: *mut AnyObject,
    observer: *mut AnyObject,
    sink: Sink,
    callbacks: Arc<AtomicU64>,
}
// The Objective-C objects are only touched while holding ACTIVE.
unsafe impl Send for Capture {}

static ACTIVE: Mutex<Option<Capture>> = Mutex::new(None);

fn property_size(object: AudioObjectId, address: &PropertyAddress) -> Option<u32> {
    let mut size = 0u32;
    let status =
        unsafe { AudioObjectGetPropertyDataSize(object, address, 0, ptr::null(), &mut size) };
    (status == 0).then_some(size)
}

fn device_name(device: AudioObjectId) -> Option<String> {
    string_property(device, NAME)
}

fn string_property(device: AudioObjectId, selector: u32) -> Option<String> {
    let address = PropertyAddress {
        selector,
        scope: SCOPE_GLOBAL,
        element: 0,
    };
    let mut name: CFStringRef = ptr::null();
    let mut size = std::mem::size_of::<CFStringRef>() as u32;
    let status = unsafe {
        AudioObjectGetPropertyData(
            device,
            &address,
            0,
            ptr::null(),
            &mut size,
            (&mut name as *mut CFStringRef).cast(),
        )
    };
    if status != 0 || name.is_null() {
        return None;
    }
    Some(unsafe { CFString::wrap_under_create_rule(name) }.to_string())
}

fn input_devices() -> Vec<(AudioObjectId, String)> {
    let address = PropertyAddress {
        selector: DEVICES,
        scope: SCOPE_GLOBAL,
        element: 0,
    };
    let Some(mut size) = property_size(SYSTEM_OBJECT, &address) else {
        return Vec::new();
    };
    let mut ids = vec![0 as AudioObjectId; size as usize / 4];
    let status = unsafe {
        AudioObjectGetPropertyData(
            SYSTEM_OBJECT,
            &address,
            0,
            ptr::null(),
            &mut size,
            ids.as_mut_ptr().cast(),
        )
    };
    if status != 0 {
        return Vec::new();
    }
    ids.truncate(size as usize / 4);
    let streams = |id| {
        let address = PropertyAddress {
            selector: STREAMS,
            scope: SCOPE_INPUT,
            element: 0,
        };
        property_size(id, &address).is_some_and(|size| size > 0)
    };
    ids.into_iter()
        .filter(|&id| streams(id))
        .filter_map(|id| device_name(id).map(|name| (id, name)))
        .collect()
}

fn default_input() -> Option<AudioObjectId> {
    let address = PropertyAddress {
        selector: DEFAULT_INPUT,
        scope: SCOPE_GLOBAL,
        element: 0,
    };
    let mut device: AudioObjectId = 0;
    let mut size = 4u32;
    let status = unsafe {
        AudioObjectGetPropertyData(
            SYSTEM_OBJECT,
            &address,
            0,
            ptr::null(),
            &mut size,
            (&mut device as *mut AudioObjectId).cast(),
        )
    };
    (status == 0 && device != 0).then_some(device)
}

fn default_input_name() -> String {
    default_input()
        .and_then(device_name)
        .unwrap_or_else(|| "System default microphone".into())
}

fn ensure_permission() -> Result<(), String> {
    let status: isize = unsafe {
        msg_send![class!(AVCaptureDevice), authorizationStatusForMediaType: AVMediaTypeAudio]
    };
    if status == AUTHORIZED {
        return Ok(());
    }
    if status != NOT_DETERMINED {
        return Err("microphone_denied".into());
    }
    let (send, receive) = mpsc::channel();
    let reply = RcBlock::new(move |granted: Bool| {
        let _ = send.send(granted.as_bool());
    });
    unsafe {
        let _: () = msg_send![class!(AVCaptureDevice),
            requestAccessForMediaType: AVMediaTypeAudio, completionHandler: &*reply];
    }
    match receive.recv_timeout(Duration::from_secs(120)) {
        Ok(true) => Ok(()),
        _ => Err("microphone_denied".into()),
    }
}

fn send_json(sink: &Sink, json: &str) {
    if let Ok(sink) = sink.lock() {
        if let Some(channel) = sink.as_ref() {
            let _ = channel.send(InvokeResponseBody::Json(json.into()));
        }
    }
}

unsafe fn release(object: *mut AnyObject) {
    if !object.is_null() {
        let _: () = msg_send![object, release];
    }
}

unsafe fn teardown(engine: *mut AnyObject, observer: *mut AnyObject, tapped: bool) {
    let input: *mut AnyObject = msg_send![engine, inputNode];
    if tapped {
        let _: () = msg_send![input, removeTapOnBus: 0usize];
    }
    let _: () = msg_send![engine, stop];
    if !observer.is_null() {
        let center: *mut AnyObject = msg_send![class!(NSNotificationCenter), defaultCenter];
        let _: () = msg_send![center, removeObserver: observer];
        release(observer);
    }
    release(engine);
}

pub fn start(
    device_name: Option<String>,
    events: Channel<InvokeResponseBody>,
) -> Result<NativeCaptureStarted, String> {
    ensure_permission()?;
    let mut active = ACTIVE.lock().map_err(|_| "microphone_busy")?;
    if active.is_some() {
        return Err("microphone_busy".into());
    }
    let device = match device_name.filter(|label| !label.is_empty()) {
        Some(label) => {
            let devices = input_devices();
            let chosen = choose_device(&label, &devices).ok_or("microphone_device_missing")?;
            let name = devices
                .iter()
                .find(|(id, _)| id == chosen)
                .map(|(_, n)| n.clone());
            Some((*chosen, name.unwrap_or(label)))
        }
        None => None,
    };
    autoreleasepool(|_| unsafe {
        let engine: *mut AnyObject = msg_send![class!(AVAudioEngine), new];
        if engine.is_null() {
            return Err("microphone_start_failed".into());
        }
        let input: *mut AnyObject = msg_send![engine, inputNode];
        if let Some((id, _)) = &device {
            let unit: *mut c_void = msg_send![input, audioUnit];
            let status = if unit.is_null() {
                -1
            } else {
                AudioUnitSetProperty(
                    unit,
                    CURRENT_DEVICE,
                    0,
                    0,
                    (id as *const AudioObjectId).cast(),
                    4,
                )
            };
            if status != 0 {
                teardown(engine, ptr::null_mut(), false);
                return Err("microphone_device_missing".into());
            }
        }
        let format: *mut AnyObject = msg_send![input, outputFormatForBus: 0usize];
        let sample_rate: f64 = if format.is_null() {
            0.0
        } else {
            msg_send![format, sampleRate]
        };
        let channel_count: u32 = if format.is_null() {
            0
        } else {
            msg_send![format, channelCount]
        };
        if sample_rate <= 0.0 || channel_count == 0 {
            teardown(engine, ptr::null_mut(), false);
            return Err("microphone_unavailable".into());
        }

        let sink: Sink = Arc::new(Mutex::new(Some(events)));
        let callbacks = Arc::new(AtomicU64::new(0));
        let tap = {
            let sink = sink.clone();
            let callbacks = callbacks.clone();
            RcBlock::new(move |buffer: *mut AnyObject, _when: *mut AnyObject| {
                callbacks.fetch_add(1, Ordering::Relaxed);
                let frames: u32 = msg_send![buffer, frameLength];
                let data: *const *const f32 = msg_send![buffer, floatChannelData];
                if data.is_null() || frames == 0 {
                    return;
                }
                let channels: Vec<&[f32]> = (0..channel_count as usize)
                    .map(|index| std::slice::from_raw_parts(*data.add(index), frames as usize))
                    .collect();
                let bytes = mono_bytes(&channels);
                if let Ok(sink) = sink.lock() {
                    if let Some(channel) = sink.as_ref() {
                        let _ = channel.send(InvokeResponseBody::Raw(bytes));
                    }
                }
            })
        };
        let _: () = msg_send![input, installTapOnBus: 0usize, bufferSize: BUFFER_FRAMES,
            format: format, block: &*tap];

        // Unplugging or reconfiguring the input stops the engine; report it as
        // the end of capture so the frontend retains the audio recorded so far.
        let changed = {
            let sink = sink.clone();
            RcBlock::new(move |_notification: *mut AnyObject| {
                send_json(&sink, r#"{"type":"ended"}"#);
            })
        };
        let center: *mut AnyObject = msg_send![class!(NSNotificationCenter), defaultCenter];
        let observer: *mut AnyObject = msg_send![center,
            addObserverForName: AVAudioEngineConfigurationChangeNotification,
            object: engine,
            queue: ptr::null_mut::<AnyObject>(),
            usingBlock: &*changed];
        let observer: *mut AnyObject = msg_send![observer, retain];

        let _: () = msg_send![engine, prepare];
        let mut error: *mut AnyObject = ptr::null_mut();
        let started: bool = msg_send![engine, startAndReturnError: &mut error];
        if !started {
            teardown(engine, observer, true);
            return Err("microphone_start_failed".into());
        }
        *active = Some(Capture {
            engine,
            observer,
            sink,
            callbacks,
        });
        Ok(NativeCaptureStarted {
            sample_rate,
            channel_count,
            device_name: device
                .map(|(_, name)| name)
                .unwrap_or_else(default_input_name),
        })
    })
}

pub fn stop() -> Result<NativeCaptureStopped, String> {
    let capture = ACTIVE
        .lock()
        .map_err(|_| "microphone_busy")?
        .take()
        .ok_or("microphone_not_recording")?;
    autoreleasepool(|_| unsafe { teardown(capture.engine, capture.observer, true) });
    let callbacks = capture.callbacks.load(Ordering::Relaxed);
    if let Ok(mut sink) = capture.sink.lock() {
        if let Some(channel) = sink.take() {
            let _ = channel.send(InvokeResponseBody::Json(format!(
                r#"{{"type":"flushed","callbacks":{callbacks}}}"#
            )));
        }
    }
    Ok(NativeCaptureStopped { callbacks })
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_foundation::{
        array::CFArray,
        base::CFType,
        dictionary::{CFDictionary, CFDictionaryRef},
        number::CFNumber,
    };
    use std::time::Instant;

    #[link(name = "CoreAudio", kind = "framework")]
    extern "C" {
        fn AudioHardwareCreateAggregateDevice(
            description: CFDictionaryRef,
            device: *mut AudioObjectId,
        ) -> i32;
        fn AudioHardwareDestroyAggregateDevice(device: AudioObjectId) -> i32;
    }
    const UID: u32 = code(b"uid ");

    /// A process-private aggregate wrapping the default microphone. Destroying
    /// it removes the device from Core Audio, like unplugging a USB microphone.
    struct Aggregate {
        id: Option<AudioObjectId>,
        name: String,
    }

    impl Aggregate {
        fn create() -> Self {
            let input = default_input().expect("a default microphone is available");
            let input_uid = string_property(input, UID).expect("the microphone has a UID");
            let name = format!("YapYap probe {}", std::process::id());
            let key = |key: &str| CFString::new(key);
            let subdevice = CFDictionary::from_CFType_pairs(&[(
                key("uid"),
                CFString::new(&input_uid).as_CFType(),
            )]);
            let description = CFDictionary::<CFString, CFType>::from_CFType_pairs(&[
                (key("name"), CFString::new(&name).as_CFType()),
                (
                    key("uid"),
                    CFString::new(&format!("com.jingxuan-zhang.yapyap.{name}")).as_CFType(),
                ),
                (key("private"), CFNumber::from(1).as_CFType()),
                (key("master"), CFString::new(&input_uid).as_CFType()),
                (
                    key("subdevices"),
                    CFArray::from_CFTypes(&[subdevice]).as_CFType(),
                ),
            ]);
            let mut id: AudioObjectId = 0;
            let status = unsafe {
                AudioHardwareCreateAggregateDevice(description.as_concrete_TypeRef(), &mut id)
            };
            assert_eq!(status, 0, "aggregate device is created");
            // Core Audio publishes the new device asynchronously.
            let deadline = Instant::now() + Duration::from_secs(3);
            while !input_devices().iter().any(|(_, device)| *device == name) {
                assert!(Instant::now() < deadline, "aggregate device is listed");
                std::thread::sleep(Duration::from_millis(50));
            }
            Self { id: Some(id), name }
        }

        fn unplug(&mut self) {
            if let Some(id) = self.id.take() {
                assert_eq!(unsafe { AudioHardwareDestroyAggregateDevice(id) }, 0);
            }
        }
    }

    impl Drop for Aggregate {
        fn drop(&mut self) {
            if let Some(id) = self.id.take() {
                unsafe { AudioHardwareDestroyAggregateDevice(id) };
            }
        }
    }

    #[derive(Default)]
    struct Events {
        bytes: usize,
        // Denied or muted input arrives as exact zeros; a live microphone never does.
        signal: bool,
        json: Vec<String>,
    }

    fn recorder() -> (Channel<InvokeResponseBody>, Arc<Mutex<Events>>) {
        let events = Arc::new(Mutex::new(Events::default()));
        let sink = events.clone();
        let channel = Channel::new(move |body| {
            let mut events = sink.lock().unwrap();
            match body {
                InvokeResponseBody::Raw(bytes) => {
                    events.bytes += bytes.len();
                    events.signal |= bytes.chunks_exact(4).any(|sample| sample != [0; 4]);
                }
                InvokeResponseBody::Json(json) => events.json.push(json),
            }
            Ok(())
        });
        (channel, events)
    }

    fn wait_for(events: &Mutex<Events>, what: &str, done: impl Fn(&Events) -> bool) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !done(&events.lock().unwrap()) {
            assert!(Instant::now() < deadline, "timed out waiting for {what}");
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    #[ignore = "Records from the default microphone through a disposable aggregate device"]
    fn macos_native_capture_device_lifecycle() {
        let mut device = Aggregate::create();
        assert_eq!(
            start(Some("Unplugged probe microphone".into()), recorder().0).err(),
            Some("microphone_device_missing".to_string())
        );

        let (channel, events) = recorder();
        let started = start(Some(device.name.clone()), channel).expect("chosen device starts");
        assert_eq!(started.device_name, device.name);
        assert!(started.sample_rate > 0.0 && started.channel_count > 0);
        let (busy, _) = recorder();
        assert_eq!(start(None, busy).err(), Some("microphone_busy".to_string()));
        wait_for(&events, "audio from the chosen device", |e| e.signal);

        device.unplug();
        wait_for(&events, "the ended event", |e| {
            e.json.iter().any(|json| json.contains(r#""ended""#))
        });
        let stopped = stop().expect("stop after device loss releases the engine");
        assert!(stopped.callbacks > 0);
        assert!(events
            .lock()
            .unwrap()
            .json
            .last()
            .is_some_and(|json| json.contains(r#""flushed""#)));
        assert_eq!(stop().err(), Some("microphone_not_recording".to_string()));

        let (channel, events) = recorder();
        start(None, channel).expect("default microphone restarts after device loss");
        wait_for(&events, "audio from the default microphone", |e| e.signal);
        stop().expect("default capture stops");
    }
}
