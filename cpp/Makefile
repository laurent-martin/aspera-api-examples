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
	conan install . --output-folder=$(BUILD_DIR) --build=missing
	@# Create and navigate to the build directory, generate build files
	cd $(BUILD_DIR) && cmake ..
	@# Build the project
	cd $(BUILD_DIR) && cmake --build .
clean:
	rm -fr $(BUILD_DIR) CMakeUserPresets.json
