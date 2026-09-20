---
name: add-canonical-facet
description: Add a canonical MyAIHub facet across every required schema, compiler and enforcement layer.
disable-model-invocation: true
argument-hint: "[facet id, name and behavior]"
---

Add the canonical facet described by:

$ARGUMENTS

Before changing code:

1. Identify all existing canonical facet definitions.
2. Find one similar facet and trace its complete lifecycle.
3. Identify every place affected by a new facet.

Verify at minimum:
- shared canonical schema;
- stable facet ID;
- validation;
- prompt/compiler integration;
- enforcement/application layer;
- serialization/deserialization if applicable;
- tests;
- versioning/migration implications if applicable.

Do not consider the task complete simply because the schema accepts the facet.

Trace the facet from canonical definition until it actually affects runtime behavior.

Run relevant tests and typecheck before finishing.