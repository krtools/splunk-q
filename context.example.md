# Environment context

Copy this file to `context.md` (auto-loaded) and describe YOUR Splunk environment.
The more specific this is, the better the generated queries. Delete anything that doesn't apply.

## Indexes and sourcetypes
- `index=web` — `sourcetype=access_combined` (Apache/nginx access logs). Fields: clientip, method, uri_path, status, bytes, useragent
- `index=app` — `sourcetype=myapp:json` (JSON app logs). Fields: level, service, trace_id, message, duration_ms
- `index=security` — `sourcetype=WinEventLog:Security`. Fields: EventCode, user, src_ip, Logon_Type
- `index=network` — `sourcetype=pan:traffic`. Fields: src_ip, dest_ip, dest_port, action, app

## Data models (accelerated)
- Authentication, Network_Traffic, Web

## Lookups
- `known_assets` (ip → owner, hostname, criticality)

## Macros
- `` `prod_hosts` `` expands to `host IN (web01, web02, api01)`

## Conventions
- Default time range: last 24 hours unless specified
- "errors" in app logs means `level IN ("ERROR", "FATAL")`
