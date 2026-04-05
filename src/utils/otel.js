import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';

// ---- Exporters (HTTP -> local collector) ----
const traceExporter = new OTLPTraceExporter({
  url: 'http://localhost:4318/v1/traces',
});

const metricExporter = new OTLPMetricExporter({
  url: 'http://localhost:4318/v1/metrics',
});

// ---- SDK ----
export const sdk = new NodeSDK({
  traceExporter,
  metricExporter,
  instrumentations: [getNodeAutoInstrumentations()],
});

// ---- Start ----
export async function startTelemetry() {
  await sdk.start();
  console.log('OpenTelemetry started');
}

// ---- Shutdown ----
export async function shutdownTelemetry() {
  await sdk.shutdown();
  console.log('OpenTelemetry stopped');
}