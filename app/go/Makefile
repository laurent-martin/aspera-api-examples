DIR_TOP=$(realpath ../..)/
TEST_CASES=server server_cmd faspex5
include $(DIR_TOP)common.mak
# location of sample code
EXAMPLES_DIR=src/examples/
BUILD_DIR=./build/
# folder of generated grpc source code
GO_GRPC_GEN_DIR=$(BUILD_DIR)grpc_aspera/
# python grpc source code files, generated from proto file, also present in SDK
GO_GRPC_SDK_SRCS=transferd.pb.go transferd_grpc.pb.go
# location of pre-generated protobuf/grpc sources provided in SDK
GO_GRPC_SDK_DIR=$(SDK_DIR_EXAMPLES)go/
# comment out this file to use generated grpc source code from SDK
GO_GRPC_SDK_DIR=
# python grpc source code files used by sample code with full path
GO_FILES_GRPC = $(foreach item,$(GO_GRPC_SDK_SRCS),$(GO_GRPC_GEN_DIR)$(item))
# Execute all samples
$(BUILD_DIR).exists:
	@mkdir -p $(BUILD_DIR)
	@touch $@
all:: $(TEST_FLAGS)
export SDK_FILE_PROTO
$(BUILD_DIR)%: $(BUILD_DIR).exists $(EXAMPLES_DIR)%.go $(shell find src/utils -name "*.go")
	go build -o $@ $(EXAMPLES_DIR)$(notdir $@).go
# Build and Execute one sample
$(DIR_TESTED_FLAG)%: $(FILES_RUNTIME) $(GBL_FILE_SAMPLE) $(GO_FILES_GRPC) $(BUILD_DIR)%
	@echo "== Test: $(notdir $@) ==========================="
	$(BUILD_DIR)$(notdir $@) $(GBL_FILE_SAMPLE)
	@sleep 2
	@mkdir -p $(DIR_TESTED_FLAG)
	@touch $@
clean::
superclean::
	rm -fr $(BUILD_DIR)
ifeq ($(GO_GRPC_SDK_DIR),)
# generate grpc source code from proto file
$(GO_FILES_GRPC): $(BUILD_DIR).exists $(SDK_FILE_PROTO)
	@printf "\e[5mGenerating stub code from $(SDK_FILE_PROTO)\e[0m\n"
	mkdir -p $(GO_GRPC_GEN_DIR)
	PATH="$$PATH:$$(go env GOPATH)/bin" protoc \
	  --go_out=$(GO_GRPC_GEN_DIR) \
	  --go_opt=paths=source_relative \
	  --go-grpc_out=$(GO_GRPC_GEN_DIR) \
	  --go-grpc_opt=paths=source_relative \
	  --proto_path=$(dir $(SDK_FILE_PROTO)) \
	  $(SDK_FILE_PROTO)
else
# copy grpc source code from SDK
$(GO_FILES_GRPC): $(BUILD_DIR).exists $(FILES_RUNTIME)
	@printf "\e[5mCopying stub code from pre-compiled proto file in SDK\e[0m\n"
	mkdir -p $(GO_GRPC_GEN_DIR)
	cp $(foreach item,$(GO_GRPC_SDK_SRCS),$(GO_GRPC_SDK_DIR)$(item)) $(GO_GRPC_GEN_DIR)
endif
