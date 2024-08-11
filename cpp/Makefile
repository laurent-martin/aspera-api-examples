BUILD_DIR = build
all:
	@# Install dependencies
	conan install . --output-folder=$(BUILD_DIR) --build=missing
	@# Create and navigate to the build directory, generate build files
	cd $(BUILD_DIR) && cmake ..
	@# Build the project
	cd $(BUILD_DIR) && cmake --build .
clean:
	rm -fr $(BUILD_DIR) CMakeUserPresets.json
