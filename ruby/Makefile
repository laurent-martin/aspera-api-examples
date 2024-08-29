DIR_TOP=$(CURDIR)/../
TEST_CASES=aoc node faspex5 server faspex4
include $(DIR_TOP)common.mak
SRC=src/
GEMFILE=$(SDK_DIR_NOARCH)/connectors/ruby/Gemfile
all:: $(TEST_FLAGS)
$(DIR_TESTED_FLAG)%: Gemfile.lock $(GBL_FILE_SAMPLE)
	@echo "== Test: $(notdir $@) ==========================="
	bundle exec $(SRC)$(notdir $@).rb $(GBL_FILE_SAMPLE)
	@sleep 2
	@mkdir -p $(DIR_TESTED_FLAG)
	@touch $@
Gemfile.lock: $(FILES_RUNTIME)
	bundle install --gemfile=$(GEMFILE)
	bundle install
clean::
	rm -f Gemfile.lock
