DIR_TOP=$(realpath ../..)/
TEST_CASES=aoc node faspex5 server
# faspex4 End of support
include $(DIR_TOP)common.mak
SRC=./src/
EXAMPLES=$(SRC)examples/
GEMFILE=$(SDK_DIR_EXAMPLES)ruby/Gemfile
all:: $(TEST_FLAGS)
$(DIR_TESTED_FLAG)%: $(GBL_FILE_SAMPLE) $(FILES_RUNTIME) Gemfile.lock
	@echo "== Test: $(notdir $@) ==========================="
	bundle exec $(EXAMPLES)$(notdir $@).rb $(GBL_FILE_SAMPLE)
	@sleep 2
	@mkdir -p $(DIR_TESTED_FLAG)
	@touch $@
Gemfile.lock:
	bundle install --gemfile=$(GEMFILE)
	bundle install
clean::
	rm -f Gemfile.lock
