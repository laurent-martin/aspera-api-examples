DIR_TOP=$(CURDIR)/../
TEST_CASES=server shares
# node_v2
include $(DIR_TOP)common.mak
# Executables are generated here:
BUILD_DIR=build/
SRC=src/
# where conan downloads libraries
CONAN_HOME=$(CURDIR)/.conan2
export CONAN_HOME
BUILD_TYPE=Release
# Execute all samples
all:: $(TEST_FLAGS)
# Execute one sample
$(FLAG_DIR)%: $(ENV_IS_SETUP) $(SAMPLE_FILE)
	@echo "== Test: $(notdir $@) ==========================="
	cd $(BUILD_DIR) && cmake --build . --target $(notdir $@) -- VERBOSE=1
	$(BUILD_DIR)$(notdir $@) $(SAMPLE_FILE)
	@sleep 2
	@mkdir -p $(FLAG_DIR)
	@touch $@
# Setup compilation environment
# 1. Install dependencies
# 2. Generate build files
$(ENV_IS_SETUP): $(SDK_FILES)
	mkdir -p $(CONAN_HOME)
	conan profile detect --force
	conan install . --output-folder=. --build=missing -s build_type=$(BUILD_TYPE)
	cmake --preset conan-release
	cd $(BUILD_DIR) && cmake .. \
		-G "Unix Makefiles" \
		-DCMAKE_BUILD_TYPE=$(BUILD_TYPE) \
		-DCMAKE_TOOLCHAIN_FILE=$(BUILD_TYPE)/generators/conan_toolchain.cmake \
		-Daspera_proto_file=$(PROTO_FILE) \
		-Dtest_cases="$(subst $() $(),;,$(TEST_CASES))"
	@touch $@
clean::
	rm -f CMakeUserPresets.json
	rm -fr $(BUILD_DIR)
superclean::
	rm -fr $(CONAN_HOME)
