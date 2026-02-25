# Examples using Java

The `TestEnvironment` class checks if the daemon is running and if not, it will start it before running the test.

Samples show logs on terminal.

## Using `maven` to build the project

The toolchain here uses `gradle`, but `maven` can also be used, refer to [Github GRPC for java](https://github.com/grpc/grpc-java) for sample maven configuration.

## Java

No `.jar` or `.class` should be used from SDK.
Instead, the `.proto` file should be used to generate the classes (grpc stubs).

The gradle file builds generated java classes from the `.proto` file for the Transfer SDK.
Any toolchain can be used to generate the classes with `protoc` and `grpc-java`.

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

## gRPC and `protoc` versions

The compilation of the `.proto` requires the use of:

- `protoc`
- gRPC for java

It is important that a compatible version of `protoc` and `grpc-java` is used.

One way to check the compatibility is to read the README.md from the branch of the `grpc-java` repository that you are using, e.g. : [gRPC java 1.43.x](https://github.com/grpc/grpc-java/tree/v1.43.x)
