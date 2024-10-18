DIR_TOP=$(realpath ..)/
TEST_CASES=server_cmd server
include $(DIR_TOP)common.mak
# location of sample code
EXAMPLES_DIR=src/examples/
# Execute all samples
all:: $(TEST_FLAGS)
export SDK_FILE_PROTO
target/%: $(EXAMPLES_DIR)%.go
	@mkdir -p target
	go build -o $@ $(EXAMPLES_DIR)$(notdir $@).go
# Build and Execute one sample
$(DIR_TESTED_FLAG)%: $(FILES_RUNTIME) $(GBL_FILE_SAMPLE) target/%
	@echo "== Test: $(notdir $@) ==========================="
	./target/$(notdir $@) $(GBL_FILE_SAMPLE)
	@sleep 2
	@mkdir -p $(DIR_TESTED_FLAG)
	@touch $@
clean::
superclean::
	rm -fr target
