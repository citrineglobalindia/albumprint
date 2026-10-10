#!/usr/bin/env bash
# Stops the local backend started with the same API_PORT (default 54321).
cd "$(dirname "$0")"; P=${API_PORT:-54321}
for f in .postgrest-$P.pid .auth-$P.pid; do [ -f $f ] && kill $(cat $f) 2>/dev/null; rm -f $f; done
