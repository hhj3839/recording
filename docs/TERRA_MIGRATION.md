# Terra generation model migration

2026-09-09: User approved all AI generation moving to gpt-5.6-terra.
The shared model policy covers comment pools, direct comments, behaviors and retries.
Legacy model environment overrides no longer affect routing. Existing stored content,
prompts, validation, retry budgets and API credentials remain unchanged.

Terra pricing and cache-write token accounting are included.
The local Korean reading/high-level comparison completed 20 candidates for each model.
Terra: 12.094 seconds, 1,823 tokens, estimated $0.011548.
Baseline mini: 5.804 seconds, 1,910 tokens, estimated $0.004520.
Both passed current automatic approval; this does not establish semantic correctness.
No stored pools or student records were changed. Behavior live quality remains untested.
