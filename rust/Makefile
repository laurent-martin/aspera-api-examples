DIR_TOP=$(realpath ..)/
TEST_CASES=server faspex5
include $(DIR_TOP)common.mak
# location of sample code
EXAMPLES_DIR=src/examples/
# Execute all samples
all:: $(TEST_FLAGS)
export SDK_FILE_PROTO
# Build and Execute one sample
$(DIR_TESTED_FLAG)%: $(FILES_RUNTIME) $(GBL_FILE_SAMPLE) $(EXAMPLES_DIR)%.rs
	@echo "== Test: $(notdir $@) ==========================="
	RUST_BACKTRACE=1 cargo run --bin $(notdir $@) $(GBL_FILE_SAMPLE)
	@sleep 2
	@mkdir -p $(DIR_TESTED_FLAG)
	@touch $@
clean::
superclean::
	rm -fr target
	rm -f Cargo.lock
