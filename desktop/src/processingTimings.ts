export const processingStages = ["preparation", "transcription", "cleanup", "destination", "insertion"] as const;
export type ProcessingStage = typeof processingStages[number];
type Outcome = "completed" | "failed" | "stopped";
type Status = "waiting" | "running" | "skipped" | Outcome;
interface Measurement { status: Status; started: number | null; ended: number | null }
const empty = (): Measurement => ({ status: "waiting", started: null, ended: null });

// Local monotonic durations only. No transcript, audio, credentials or telemetry.
export class ProcessingTimings {
  readonly stages = Object.fromEntries(processingStages.map(stage => [stage, empty()])) as Record<ProcessingStage, Measurement>;
  readonly total: Measurement;
  constructor(readonly label: string, private readonly now = () => performance.now()) {
    this.total = { status: "running", started: now(), ended: null };
  }
  get running() { return this.total.status === "running"; }
  start(stage: ProcessingStage) {
    if (!this.running || this.stages[stage].status !== "waiting") return;
    this.stages[stage] = { status: "running", started: this.now(), ended: null };
  }
  end(stage: ProcessingStage, outcome: Outcome = "completed") {
    const metric = this.stages[stage];
    if (metric.status !== "running") return;
    metric.status = outcome;
    metric.ended = this.now();
  }
  skip(stage: ProcessingStage) {
    if (this.stages[stage].status === "waiting") this.stages[stage].status = "skipped";
  }
  finish(outcome: Outcome) {
    if (!this.running) return;
    for (const stage of processingStages) {
      this.end(stage, outcome);
      this.skip(stage);
    }
    this.total.status = outcome;
    this.total.ended = this.now();
  }
  display(stage: ProcessingStage | "total"): string {
    const metric = stage === "total" ? this.total : this.stages[stage];
    if (metric.started === null) return metric.status === "skipped" ? "Skipped" : "Waiting";
    const seconds = Math.max(0, (metric.ended ?? this.now()) - metric.started) / 1000;
    const suffix = metric.status === "completed" ? "" : ` · ${metric.status}`;
    return `${seconds.toFixed(2)} s${suffix}`;
  }
}
