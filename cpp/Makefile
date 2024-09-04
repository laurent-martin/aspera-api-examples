DIR_TOP=$(realpath ..)/
TEST_CASES=server shares node_v2
include $(DIR_TOP)common.mak
# Executables are generated here:
BUILD_DIR=build/
SRC=src/
# location of generated protobuf/grpc sources in SDK
SDK_DIR_CPP=$(SDK_DIR_NOARCH)connectors/cpp/
# where conan downloads libraries
CONAN_HOME=$(CURDIR)/.conan2
export CONAN_HOME
BUILD_TYPE=Release
CMAKE_VARS=\
	-Daspera_proto_file=$(SDK_FILE_PROTO) \
	-Dsdk_cpp_dir=$(SDK_DIR_CPP) \
	-Dcompile_proto=TRUE \
	-Dtest_cases="$(subst $() $(),;,$(TEST_CASES))"
# Execute all samples
all:: $(TEST_FLAGS)
# Execute one sample
$(DIR_TESTED_FLAG)%: $(BUILD_DIR)/Makefile $(FILES_RUNTIME) $(GBL_FILE_SAMPLE) src/%.cpp
	@echo "== Test: $(notdir $@) ==========================="
	cd $(BUILD_DIR) && cmake --build . --target $(notdir $@) -- VERBOSE=1
	$(BUILD_DIR)$(notdir $@) $(GBL_FILE_SAMPLE)
	@sleep 2
	@mkdir -p $(DIR_TESTED_FLAG)
	@touch $@
# Setup compilation environment
# 1. Install dependencies
# 2. Generate build files
$(BUILD_DIR)/Makefile: CMakeLists.txt $(CONAN_HOME)/profiles/default
	conan install . \
		--output-folder=. \
		--build=missing \
		-s build_type=$(BUILD_TYPE)
	cmake --preset conan-release $(CMAKE_VARS)
	cd $(BUILD_DIR) && cmake .. \
		-G "Unix Makefiles" \
		-DCMAKE_BUILD_TYPE=$(BUILD_TYPE) \
		-DCMAKE_TOOLCHAIN_FILE=$(BUILD_TYPE)/generators/conan_toolchain.cmake \
		$(CMAKE_VARS)
	@touch $@
$(CONAN_HOME)/profiles/default:
	conan profile detect --force
clean::
	rm -fr $(BUILD_DIR)
superclean::
	rm -f CMakeUserPresets.json
	rm -fr $(CONAN_HOME)
