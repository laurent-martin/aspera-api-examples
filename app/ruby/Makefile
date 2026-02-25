DIR_TOP=$(realpath ../..)/
include $(DIR_TOP)common.mak
TEST_CASES= node node_v2 faspex5 server aoc
# End of support: faspex4 
SRC=./src/
EXAMPLES=$(SRC)examples/
COMMON_SRC=$(SRC)utils/configuration.rb $(SRC)utils/transfer_client.rb $(SRC)utils/rest.rb
# folder where grpc source code will be generated
RB_GRPC_GEN_DIR=$(SRC)
# ruby grpc source code files, generated from proto file, also present in SDK
RB_GRPC_SDK_SRCS=transferd_pb.rb transferd_services_pb.rb
# location of pre-generated protobuf/grpc sources provided in SDK
RB_GRPC_SDK_DIR=$(SDK_DIR_EXAMPLES)ruby/
# comment out this line to use generated grpc source code from SDK
RB_GRPC_SDK_DIR=
# ruby grpc source code files used by sample code with full path
RB_FILES_GRPC = $(foreach item,$(RB_GRPC_SDK_SRCS),$(RB_GRPC_GEN_DIR)$(item))
GEMFILE=$(SDK_DIR_EXAMPLES)ruby/Gemfile
all:: $(TEST_FLAGS)
$(DIR_TESTED_FLAG)%: $(GBL_FILE_SAMPLE) $(FILES_RUNTIME) Gemfile.lock $(RB_FILES_GRPC) $(COMMON_SRC) $(EXAMPLES)%.rb
	@echo "== Test: $(notdir $@) ==========================="
	bundle exec $(EXAMPLES)$(notdir $@).rb $(GBL_FILE_SAMPLE)
	@sleep 2
	@mkdir -p $(DIR_TESTED_FLAG)
	@touch $@
Gemfile.lock:
	bundle install --gemfile=$(GEMFILE)
	bundle install
ifeq ($(RB_GRPC_SDK_DIR),)
# generate gRPC source code from proto file
# see https://grpc.io/docs/languages/ruby/quickstart/
$(RB_FILES_GRPC): $(SDK_FILE_PROTO)
	@printf "\e[5mGenerating stub code from $(SDK_FILE_PROTO)\e[0m\n"
	mkdir -p $(RB_GRPC_GEN_DIR)
	grpc_tools_ruby_protoc\
	  --grpc_out=$(RB_GRPC_GEN_DIR)\
	  --ruby_out=$(RB_GRPC_GEN_DIR)\
	  --proto_path=$(dir $(SDK_FILE_PROTO))\
	  $(SDK_FILE_PROTO)
else
# copy grpc source code from SDK
$(RB_FILES_GRPC): $(FILES_RUNTIME)
	@printf "\e[5mCopying stub code from pre-compiled proto file in SDK\e[0m\n"
	mkdir -p $(RB_GRPC_GEN_DIR)
	cp $(foreach item,$(RB_GRPC_SDK_SRCS),$(RB_GRPC_SDK_DIR)$(item)) $(RB_GRPC_GEN_DIR)
endif
clean::
	rm -f Gemfile.lock
	rm -f $(RB_FILES_GRPC)
