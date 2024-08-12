DIR_TOP=../
include $(DIR_TOP)/common.make
SRC=src/
BUILD_DIR=build
# list of samples
all:: $(T)server
# execute one sample
$(T)%: $(IS_OK)
	name='$@' && $(BUILD_DIR)/$${name#$(T)} $(TSTFILE)
	@touch $@
# ensure SDK is there
../$(IS_OK):
	cd .. && make
# compile all samples
$(IS_OK): ../$(IS_OK)
	@# Install dependencies
	conan install . --output-folder=. --build=missing -s build_type=Release
	cmake --preset conan-release
	@# Generate build files
	cd $(BUILD_DIR) && \
	cmake .. -G "Unix Makefiles" -DCMAKE_TOOLCHAIN_FILE=Release/generators/conan_toolchain.cmake  -DCMAKE_BUILD_TYPE=Release
	@# Build the project
	cd $(BUILD_DIR) && cmake --build . -- VERBOSE=1
clean: clean_flags
	rm -fr $(BUILD_DIR) CMakeUserPresets.json file
