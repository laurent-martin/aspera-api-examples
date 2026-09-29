# Examples using Java

The `TransferClient` class starts the Transfer Daemon, if not already started, before the transfer.

Requirements: Gradle 9 and a JDK 25 or newer.

Samples log to the terminal.

## Run a sample manually

To run a sample without `make`, for example in a debugger,
first run it once with `make` (for example `make .tested/Faspex5Send`):
this downloads the SDK, installs the dependencies, and generates the gRPC stub code.
Then, in this folder:

```bash
java -cp build/libs/java_samples-*-all.jar -Djava.util.logging.config.file=logging.properties \
  examples.Faspex5Send /path/to/file
```

Arguments are the files to transfer.
The main folder of the repository is found from the current folder: to use another one, set the system property `dir_top` (`-Ddir_top=...`).

## Using `maven` to build the project

The toolchain here uses `gradle`, but `maven` can also be used:
refer to [gRPC-Java on GitHub](https://github.com/grpc/grpc-java) for a sample Maven configuration.

## Java

No `.jar` or `.class` file from the SDK should be used.
Instead, the `.proto` file should be used to generate the classes (gRPC stubs).

The Gradle build generates the Java classes from the `.proto` file of the Transfer Daemon SDK.
Any toolchain can be used to generate the classes with `protoc` and `grpc-java`.

```text
╭───────────────╮                                    ╭───────────────╮
│ Application   │                                    │ Faspex 5      │
╞═══════════════╡                                    │               │
│ App Classes   │ -------------API(REST)------------>│               │
╞═══════════════╡                                    ╰───────────────╯
│  Generated    │              ╭───────────────╮             |
│ Stub Classes  │ <--compile-- │ proto file    │             |
╰───────────────╯              ╰───────────────╯             |
        |                                                    |
       GRPC                                               API(REST)
        |                                                    |
        v                                                    v
╭───────────────╮                                    ╭───────────────╮
│ transferd     │                                    │ HSTS          │
│               │                                    │               │
│ ascp          │ ------------transfer-------------->│ FASP          │
╰───────────────╯                                    ╰───────────────╯
  | Native executables
```

Classes are compiled for Java 25 (`--release 25`) with the JDK used by Gradle: any JDK 25 or newer.

To use a specific JDK, set the environment variable `JAVA_HOME`, for example on macOS:

```bash
JAVA_HOME=$(/usr/libexec/java_home -v 25) make
```

## gRPC and `protoc` versions

The compilation of the `.proto` file requires:

- `protoc`
- gRPC for Java (`grpc-java`)

It is important that compatible versions of `protoc` and `grpc-java` are used (defined in `build.gradle`).

One way to check the compatibility is to read the `README.md` from the branch of the `grpc-java` repository
that you are using, for example: [gRPC Java 1.84.x](https://github.com/grpc/grpc-java/tree/v1.84.x)
