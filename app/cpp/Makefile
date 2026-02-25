DIR_TOP=$(realpath ../..)/
TEST_CASES=server shares node_v2 faspex5 aoc
include $(DIR_TOP)common.mak
# Executables are generated here:
CPP_BUILD_DIR=build/
# location of pre-generated protobuf/grpc sources provided in SDK
CPP_GRPC_SDK_DIR=$(SDK_DIR_EXAMPLES)cpp/
# comment this line to use gRPC stubs provided in the SDK
CPP_GRPC_SDK_DIR=
# location of sample code
EXAMPLES_DIR=src/examples/
# where conan will download libraries
CONAN_HOME=$(CURDIR)/.conan2
export CONAN_HOME
CONAN_PRESET=conan-release
CMAKE_BUILD_TYPE=Release
# variables used in CMakeLists.txt
CMAKE_USER_VARS=\
	-Daspera_proto_file=$(SDK_FILE_PROTO) \
	-Dsdk_cpp_dir=$(CPP_GRPC_SDK_DIR) \
	-Dexamples_dir=$(EXAMPLES_DIR) \
	-Dtest_cases="$(subst $() $(),;,$(TEST_CASES))"
# Execute all samples
all:: $(TEST_FLAGS)
# Build and Execute one sample
$(DIR_TESTED_FLAG)%: $(FILES_RUNTIME) $(GBL_FILE_SAMPLE) $(CPP_BUILD_DIR)/Makefile $(EXAMPLES_DIR)%.cpp $(shell find src/utils -name "*.hpp")
	@echo "== Test: $(notdir $@) ==========================="
	cd $(CPP_BUILD_DIR) && cmake --build . --target $(notdir $@) -- VERBOSE=1
	$(CPP_BUILD_DIR)$(notdir $@) $(GBL_FILE_SAMPLE)
	@sleep 2
	@mkdir -p $(DIR_TESTED_FLAG)
	@touch $@
# Setup compilation environment
# 1. Install dependencies
# 2. Configure cmake
# 3. Generate build files
$(CPP_BUILD_DIR)/Makefile: CMakeLists.txt $(CONAN_HOME)/profiles/default
	conan install . \
		--output-folder=. \
		--build=missing \
		-s build_type=$(CMAKE_BUILD_TYPE)
	cmake --preset $(CONAN_PRESET)
	cd $(CPP_BUILD_DIR) && cmake .. \
		-G "Unix Makefiles" \
		-DCMAKE_BUILD_TYPE=$(CMAKE_BUILD_TYPE) \
		-DCMAKE_TOOLCHAIN_FILE=$(CMAKE_BUILD_TYPE)/generators/conan_toolchain.cmake \
		$(CMAKE_USER_VARS)
	@touch $@
# Generate a default compilation profile
$(CONAN_HOME)/profiles/default:
	@for c in conan cmake protoc;do \
		if ! command -v $$c &>/dev/null; then \
			echo "$$c is not installed"; \
			exit 1; \
		fi; \
	done
	conan profile detect --force
clean::
	rm -fr $(CPP_BUILD_DIR)
superclean::
	rm -f CMakeUserPresets.json
	rm -fr $(CONAN_HOME)
