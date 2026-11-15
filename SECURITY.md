# Security policy

YapYap keeps your OpenAI API key and handles your microphone audio, so security reports are welcome and taken seriously.

## Supported versions

Only the latest release gets security fixes. YapYap has no automatic updates yet, so after a fix is released, download and install the new version.

## Reporting a vulnerability

**Please don't open a public issue for a security problem.**

Report it privately through GitHub instead: open the repository's **Security** tab and choose **Report a vulnerability**. Include:

- what the problem is and what an attacker could do with it;
- the YapYap version and your OS;
- the steps to reproduce it, or a proof of concept.

**Never include a real API key, recording or transcript in your report.** Use a revoked key or a made-up value.

You should hear back within a week. Once a fix is released, the advisory will be published, with credit to you unless you'd rather stay anonymous.

## What's in scope

Things that matter most:

- the API key leaving the OS credential store other than in requests to OpenAI. That includes logs, the UI layer, crash output, files on disk and IPC responses.
- audio or transcripts being written to disk, sent to anyone other than OpenAI, or kept after the session is discarded. The one exception is a **Download WAV** that you chose yourself.
- script injection into either app window, or a way around the Content Security Policy.
- text pasted into a different app or window than the one checked before pasting, or a newer clipboard copy being overwritten.

Out of scope:

- anything that needs an attacker who already controls your user account or can read process memory;
- OpenAI's own handling of data you send them;
- SmartScreen or Gatekeeper warnings on unsigned builds, which are a known limitation.

See [docs/KEY_SECURITY.md](docs/KEY_SECURITY.md) for how the key is handled and how to run the local leak audit.
