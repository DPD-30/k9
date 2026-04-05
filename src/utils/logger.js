import pino from 'pino';
import { context, trace } from '@opentelemetry/api';

// Inject trace/span IDs into logs
function traceMixin() {
  const span = trace.getSpan(context.active());
  if (!span) return {};

  const spanContext = span.spanContext();

  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
  };
}

export const logger = pino({
  level: 'info',
  mixin: traceMixin,
});