DIR_TOP=../
include $(DIR_TOP)/common.make
# Executables are generated here:
BUILD_DIR=build
# Sample file to transfer
SAMPLE_FILE=$(TMPDIR)/This_is_a_test.txt
# List of tests, also in CMakeLists.txt, in last loop
TEST_MARKS=$(T)server $(T)shares $(T)node_v2
CONAN_HOME=$(PWD)/.conan2
export CONAN_HOME
# Execute all samples
all:: $(TEST_MARKS)
# Execute one sample
$(T)%: $(IS_OK) $(SAMPLE_FILE)
	name='$@' && cd $(BUILD_DIR) && cmake --build . -- VERBOSE=1 $${name#$(T)}
	name='$@' && $(BUILD_DIR)/$${name#$(T)} $(SAMPLE_FILE)
	@touch $@
# Ensure SDK is there
../$(IS_OK):
	cd .. && make
$(SAMPLE_FILE):
	@echo "Generating test file: $(SAMPLE_FILE)"
	date > $(SAMPLE_FILE)
# Setup compilation environment
# 1. Install dependencies
# 2. Generate build files
$(IS_OK): ../$(IS_OK)
	mkdir -p $(CONAN_HOME)
	conan profile detect --force
	conan install . --output-folder=. --build=missing -s build_type=Release
	cmake --preset conan-release
	cd $(BUILD_DIR) && cmake .. \
		-G "Unix Makefiles" \
		-DCMAKE_BUILD_TYPE=Release \
		-DCMAKE_TOOLCHAIN_FILE=Release/generators/conan_toolchain.cmake
	@touch $@
clean: clean_flags
	rm -fr $(TEST_MARKS) $(BUILD_DIR) CMakeUserPresets.json $(SAMPLE_FILE) $(IS_OK)
superclean: clean
	rm -fr $(CONAN_HOME)
.PHONY: all clean superclean
