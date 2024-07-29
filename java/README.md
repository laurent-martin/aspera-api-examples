# Examples using Java

The TestEnvironment class checks if the daemon is running and if not, it will start it before running the test.

Samples show logs on terminal.

The gradle file builds generated java classes from the `.proto` file for the Transfer SDK.

## Java version

No `.jar` or `.class` should be used from SDK.
Instead, the `.proto` file should be used to generate the classes (grpc stubs).

```text
╭───────────────╮                                    ╭───────────────╮
│ Application   │                                    │ Faspex 5      │
╞═══════════════╡                                    │               │
│ App Classes   │ -------------API(REST)------------>│               │
╞═══════════════╡                                    ╰───────────────╯
│  Generated    │              ╭───────────────╮             |
│ Stub Classes  │ <--compile-- │ proto files   │             |
╰───────────────╯              ╰───────────────╯             |
        |                                                    |
       GRPC                                               API(REST)
        |                                                    |
        v                                                    v
╭───────────────╮                                    ╭───────────────╮
│asperatransferd│                                    │ HSTS          │
│ shared lib    │                                    │               │
│ ascp          │ ------------transfer-------------->│ FASP          │
╰───────────────╯                                    ╰───────────────╯
  | Native executables
```

The appropriate toolchain should be used to match your java version.

To test the example with a specific java version set the env var `JAVA_HOME`, for example on macos:

```bash
JAVA_HOME=/opt/homebrew/Cellar/openjdk@11/11.0.23 make
```
