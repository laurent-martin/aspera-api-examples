DIR_TOP=$(CURDIR)/../
TEST_CASES=aoc node faspex5 server faspex4
include $(DIR_TOP)common.mak
SRC=src/
GEMFILE=$(GLOBAL_TRSDK_NOARCH)/connectors/ruby/Gemfile
all:: $(TEST_FLAGS)
$(FLAG_DIR)%: $(ENV_IS_SETUP) $(SAMPLE_FILE)
	@echo "== Test: $(notdir $@) ==========================="
	bundle exec $(SRC)$(notdir $@).rb $(SAMPLE_FILE)
	@sleep 2
	@mkdir -p $(FLAG_DIR)
	@touch $@
$(ENV_IS_SETUP): $(SDK_FILES)
	bundle install --gemfile=$(GEMFILE)
	bundle install
	@touch $@
clean::
	rm -f Gemfile.lock
