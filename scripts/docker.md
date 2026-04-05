docker run \
  -p 4318:4318 \
  -v $(pwd)/logs:/logs \
  -v $(pwd)/otel-collector.yaml:/etc/otelcol/config.yaml \
  otel/opentelemetry-collector \
  --config /etc/otelcol/config.yaml