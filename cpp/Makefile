DIR_TOP=$(PWD)/../
TEST_CASES=server shares node_v2
include $(DIR_TOP)common.mak
# Executables are generated here:
BUILD_DIR=build/
SRC=src/
# where conan downloads libraries
CONAN_HOME=$(PWD)/.conan2
export CONAN_HOME
BUILD_TYPE=Release
# Execute all samples
all:: $(TEST_FLAGS)
# Execute one sample
$(FLAG_DIR)%: $(FLAG_DIR) $(IS_OK) $(SAMPLE_FILE)
	cd $(BUILD_DIR) && cmake --build . --target $(notdir $@)
	$(BUILD_DIR)/$(notdir $@) $(SAMPLE_FILE)
	@touch $@
# Setup compilation environment
# 1. Install dependencies
# 2. Generate build files
$(IS_OK): $(SDK_FILES)
	mkdir -p $(CONAN_HOME)
	conan profile detect --force
	conan install . --output-folder=. --build=missing -s build_type=$(BUILD_TYPE)
	cmake --preset conan-release
	cd $(BUILD_DIR) && cmake .. \
		-G "Unix Makefiles" \
		-DCMAKE_BUILD_TYPE=$(BUILD_TYPE) \
		-Daspera_proto_file=$(PROTO_FILE) \
		-DCMAKE_TOOLCHAIN_FILE=$(BUILD_TYPE)/generators/conan_toolchain.cmake \
		-Dtest_cases="$(subst $() $(),;,$(TEST_CASES))"
	@touch $@
clean::
	rm -f $(TEST_FLAGS) $(IS_OK) CMakeUserPresets.json
	rm -fr $(BUILD_DIR)
superclean::
	rm -fr $(CONAN_HOME)
