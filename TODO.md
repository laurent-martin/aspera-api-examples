# TODO

Review of the sample applications in `app/` (2026-09-28).

Order of work:

1. Failures must be reported (non-zero exit code), otherwise `make` marks samples as tested.
2. Confirmed bugs.
3. Security and dependencies.
4. Align `TransferClient` behavior across languages.
5. Documentation.
6. Tooling (CI, lint, dependency updates).

> [!NOTE]
> Validation of the fixes done so far: all languages build, and a local test (not committed)
> starts, connects to and stops the daemon twice with port 0 (Python, JS and Ruby: also a daemon startup failure).
> No transfer to a server was executed: run `make` in each `app/<language>` folder to validate with servers.

## 1. Failures silently ignored (`.tested/` flag created on failure)

- [x] JS: `startConnectDaemon` only logs errors (`app/js/src/utils/transfer_client.js`)
- [x] JS: `throw` inside stream callbacks is uncaught (now: `fail()` stops the daemon and exits with code 1)
- [x] JS: move `TransferClient` to a Promise/async API (`startup`, `startTransferAndWait`, `shutdown`; no `process.exit` in the library)
- [x] JS: `aoc.js` logs "Transfer completed!" before the transfer starts
- [x] Go: `faspex5.go`, `server.go` ignore errors; `Log.Fatalf` skips `defer Shutdown()` (now: `run() error`)
- [x] Java: `session_wait_for_completion` breaks on `FAILED` without throwing
- [x] Java: `session_start` ignores status/error of `StartTransfer`
- [x] C++: `grpc::Status` of `StartTransfer` / `QueryTransfer` ignored
- [x] Rust: status/error of `StartTransfer` response ignored
- [x] C#: `WaitTransfer` breaks on `Failed` without throwing
- [x] C#: `StartTransfer` calls `Environment.Exit(1)` on failure (daemon not stopped)
- [x] Python, Ruby: samples call `startup()` outside `try`: daemon left running if startup fails (now: `startup` stops it)

## 2. Confirmed bugs

### All languages

Port 0 (default in `config/config.tmpl`) does not work with `transferd` 1.1.5:
the log is in text format (not JSON), and the API port line
(`API Server: Listening on 127.0.0.1:<port> ...`) is logged about 2.4 s after start,
i.e. after the fixed 2 s sleep. Reading the last log line as JSON fails.

Fix (verified locally in all languages): record the log size before start, then poll the new lines
for `API Server: Listening on [^\s"]+:(\d+)` (works for text and JSON formats) with a timeout,
checking that the daemon is still running; then connect with wait-for-ready or retry, with a timeout.
Port 0 requires `trsdk.level` `info` or more verbose.

- [x] Go
- [x] Python (also: daemon started without shell)
- [x] JS
- [x] Java
- [x] Ruby
- [x] C++
- [x] Rust
- [x] C#
- [x] Default port 55002 when the URL has no port (all languages)
- [x] `common.mak`: `clean_daemon` runs `killall transferd`, which also kills `transferd` instances not started by the samples (e.g. `~/.aspera/sdk/transferd`); now matches the executable path of the samples daemon

### Python

- [x] `aoc.py`: nested f-string with same quotes is a `SyntaxError` before Python 3.12 (README says 3.11+)
- [x] `faspex5.py`: `raise "..."` raises `TypeError`; remote transfer wait loop has no timeout
- [x] `faspex5.py`: mutable default argument `query=[]` in `lookup_entity`
- [x] `transfer_client.py`: `shutdown()` condition inverted (`is None`), service never reset; gRPC channel not closed
- [x] `configuration.py`: `add_sources` uses `split('/')` instead of `os.path.basename`
- [x] `requirements.txt`: `google` is an unrelated PyPI package
- [x] `cos.py`: calls `node_api.post`, which does not exist in `Rest` (use `create`)

### JS

- [x] `configuration.js`: parameter `path` of `addSources` shadows the `path` module (`path.basename` fails)
- [x] `faspex5.js`: reads `transfer.sessions`, a section absent from the config template
- [x] `configuration.js`: `getParam` returns `undefined` for a missing parameter instead of failing (now optional default value, like Python)
- [x] `rest.js`: token request uses `auth` and `responseType`, which are not `ky` options: client credentials (Basic) never sent
- [x] `rest.js`: `setVerify(false)` has no effect (now: undici agent without certificate verification)

### Go

- [x] `faspex5.go`, `server.go`: `config` is `nil` when `NewConfiguration` fails, `config.Log` panics
- [x] `transfer_client.go`: `ProcessState` is `nil` without `Wait()`, dead daemon never detected
- [x] `transfer_client.go`: `CreateConfigFile` error ignored
- [x] `transfer_client.go`: port regex applied to the whole JSON log line, not to `msg`
- [x] `transfer_client.go`: "Connected!" logged without any call to the daemon (now: `GetInfo`)
- [x] `transfer_client.go`: `Shutdown` does not wait for the process nor close the channel
- [x] `configuration.go`: log level read from config but never applied
- [x] `configuration.go`: `AddSources` only accepts `[]map[string]string` (fails on decoded JSON)

### Java

- [x] `start_transfer_and_wait` restarts and reconnects the daemon on each call ("already connected" on 2nd call)
- [x] `Runtime.exec` does not drain stdout/stderr of the daemon (now: `ProcessBuilder.redirectOutput`)
- [x] Streaming: `onCompleted()` called inside the per-file loop (fails with more than one file)
- [x] `shutdown` does not close the `ManagedChannel`

### C++

- [x] `CMakeLists.txt`: `set(CXX_STANDARD 17)` has no effect (`CMAKE_CXX_STANDARD`)
- [x] `CMakeLists.txt`: `if(${sdk_cpp_dir})` is always false for a path (`if(sdk_cpp_dir)`)
- [x] `transfer_client.hpp`: `kill(pid, 0)` succeeds on a zombie, daemon failure not detected (now: `waitpid`)
- [x] `Makefile`: `&>` is a bashism, breaks the tool check with dash
- [x] `server.cpp`: `assert(server_uri.scheme == "ssh")` compiles only because `NDEBUG` removes it
- [x] Build fails with current gRPC: macro `LOG` of the samples is redefined by Abseil (`absl/log/log.h`), renamed `LOGGER`

### C\#

- [x] `Configuration.cs`: `LastFileLine` returns `""` when the file ends with `\n`
- [x] `Configuration.cs`: dead assignment of `mTopFolder`

### Go and Rust

- [x] Default gRPC port is 33001 (SSH port) when the URL has no port (now: 55002)
- [x] Rust: `daemon_shutdown` does not wait for the process

### Ruby

- [x] `throw_on_error` reads `.errorDescription` on an `Error` message, which only has `code` and `description` (`NoMethodError` on failure)

## 3. Security and dependencies

- [x] Go: `rest.go` logs the private key and the client secret
- [ ] Java: RSA private key hard-coded in `TransferClient.java` (workaround for SDK 1.1.3, repo requires 1.1.5+)
- [x] Java: snakeyaml 1.30 (CVE-2022-1471), org.json 20211205 (CVE-2022-45688, CVE-2023-5072), jjwt 0.11.5 (now 2.7, 20260814, 0.13.0 with non-deprecated API; gRPC 1.84.0)
- [x] Java: shadow plugin `com.github.johnrengelman.shadow` archived, use `com.gradleup.shadow` (8.3.9; removed configuration deprecated in Gradle 9)
- [x] Java: unirest versions mismatch (4.4.4 / 4.2.9): `unirest-object-mappers-gson` replaced by `unirest-modules-gson` 4.10.1
- [ ] Java: Gradle 8 hard requirement (Gradle 9 requires shadow plugin 9.x)
- [x] Java: `Rest.setAuthBearer` logs `authData` (client secret) at FINE level
- [x] Go: `dgrijalva/jwt-go` archived (CVE-2020-26160), use `golang-jwt/jwt/v5`
- [x] Go: `twinj/uuid` unmaintained, use `google/uuid`; `x/crypto` v0.26.0 has SSH CVEs (govulncheck: 10 reachable vulnerabilities in x/crypto and grpc, now 0; `go` directive 1.26 required by grpc 1.84)
- [ ] Go: GO-2026-6443 (grpc server transport, not reachable from the client samples): fixed only in grpc 1.85.0-dev, update when released
- [x] Debug logs contain credentials: HTTP traces with `Authorization` headers, bearer tokens, JWT assertions (JS, C++, C#, Rust): now masked (`***`). Note: transfer specs (with transfer tokens) are still logged at debug level, to show them
- [x] C++: REST client never verified the server certificate (`verify` flag stored but not applied; `ssl::context` defaults to `verify_none`); now CA from OpenSSL defaults, `SSL_CERT_FILE`, or system bundle (OpenSSL built by conan has none), and host name verification
- [x] C++: `ssl::context::tlsv13` (a method) passed as option
- [x] C#: `verify: false` not supported (now `setVerify`, used by the Faspex 5 sample); JWT without `jti`
- [x] Rust: HTTP error messages print the literal text `response.status()` instead of the status
- [x] JS: `ky` 2 hooks receive a state object: HTTP debug traces failed
- [x] Go: `grpc.WithInsecure` deprecated
- [x] C#: `net7.0` end of life, move to `net10.0` (current .NET SDK has no 7.0 runtime: samples do not start); `Grpc.Core` deprecated (`Grpc.Net.Client` is enough)
- [x] C#: known vulnerabilities reported by NuGet in `BouncyCastle.Cryptography` 2.2.1 (unused: removed) and `log4net` 2.0.15 (now 3.4.0); other packages updated; obsolete `packages.config` renamed to `Directory.Packages.props` (central package management, history kept), lock file `packages.lock.json`
- [x] C#: `Nullable` is `disable`: enabling it gives about 48 warnings to fix (annotations of nullable types) (now `enable`, 0 warning: 25 distinct warnings fixed; `Rest.call` returns an empty object for an empty response)
- [x] C#: private key file only accepted in PKCS#1 format (`BEGIN RSA PRIVATE KEY`), OpenSSL 3 generates PKCS#8 by default (now `RSA.ImportFromPem`)
- [x] Rust: update tonic 0.9, prost 0.11, reqwest 0.11, jsonwebtoken 8; `from_i32` deprecated (now tonic/prost 0.14 with `tonic-prost-build`, reqwest 0.13, jsonwebtoken 11 with aws-lc-rs backend, deprecated `serde_yaml` replaced by `serde_yaml_ng`, edition 2024; `cargo audit`: 0 vulnerability)
- [x] JS: `@grpc/proto-loader ^0.5.4` very old; runtime deps declared in `devDependencies` (all updated: ky 2, js-yaml 5, proto-loader 0.8; `uuid` replaced by `crypto.randomUUID`; `npm audit`: 0 vulnerability)
- [x] Python: pin versions; remove `PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION=python` workaround; `yaml.safe_load`; `timeout=` on `requests` (protobuf now uses the native `upb` implementation; no private `requests` API; `pip-audit`: 0 vulnerability)
- [x] Commit lock files (`clean`/`clobber` delete `package-lock.json`, `Cargo.lock`, `Gemfile.lock`): now committed, installed with `npm ci`, `cargo run --locked`, `bundle install` (flag file `.gems_installed`, the lock file is no longer a make target); `npm audit`, `cargo audit`, `bundle-audit`: 0 vulnerability

## 4. Align `TransferClient` across languages

Reference contract:

- [x] Readiness: wait-for-ready or retry with timeout instead of fixed `sleep` (see phase 2, "All languages")
- [x] Failure: raise/return error and exit with non-zero code (verified end-to-end in the 8 languages: `server` sample with an unreachable server)
- [x] Failure message: `error` is empty in `SESSION_ERROR` events, the cause is in `sessionInfo.errorDesc` / `transferInfo.errorDescription` (all languages)
- [x] `startup` / `shutdown` idempotent
- [x] Shutdown: SIGTERM, then kill after timeout; wait for process; close channel (transferd stops cleanly on SIGINT, not on SIGTERM: now SIGINT, then kill after 5 s, in the 8 languages; Windows: immediate stop; clean stop verified in the 8 languages, kill after timeout tested in Python only)
- [x] README: matrix of available samples per language (`TEST_CASES` differ)

## 5. Documentation

- [ ] `README.md`: config example uses `user`/`pass`, code uses `username`/`password`; `faspex5` and `shares` sections missing
- [ ] `config/config.tmpl`: personal path in `local.file`
- [ ] `app/python/README.md`: `transfer_pb2.py`, `utils.tools`, `TransferClient()`, `CONFIG`, `make stop` are outdated
- [ ] `app/python/src/examples/node.py`: comment mentions FASP Manager
- [x] `app/csharp/README.md`: `transfer.proto` and generated stubs path outdated
- [x] `app/java/build.gradle`: default `proto_file` is `transfer.proto`
- [ ] `app/java/build.gradle`: `mainClass` without package
- [ ] French comments in Rust sources (Go done)
- [x] `misc.level: warning` is not a valid winston level (`warn`)

## 6. Tooling

- [ ] GitHub Actions: generate stubs and build each language (no server needed)
- [ ] Linters: ruff, eslint, golangci-lint, clippy, rubocop
- [ ] Dependabot or Renovate
