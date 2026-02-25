DIR_TOP=$(realpath ../..)/
TEST_CASES=server faspex5 server_cmd aoc
include $(DIR_TOP)common.mak
# location of sample code
EXAMPLES_DIR=src/examples/
# Execute all samples
all:: $(TEST_FLAGS)
# used in build.rs:
export SDK_FILE_PROTO
# Build and Execute one sample
$(DIR_TESTED_FLAG)%: $(GBL_FILE_SAMPLE) $(FILES_RUNTIME) $(EXAMPLES_DIR)%.rs
	@echo "== Test: $(notdir $@) ==========================="
	RUST_BACKTRACE=1 cargo run --bin $(notdir $@) $(GBL_FILE_SAMPLE)
	@sleep 2
	@mkdir -p $(DIR_TESTED_FLAG)
	@touch $@
clean::
superclean::
	rm -fr target
	rm -f Cargo.lock
