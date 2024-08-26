DIR_TOP=../
include $(DIR_TOP)/common.mak
SRC=src/
GEMFILE=$(GLOBAL_TRSDK_NOARCH)/connectors/ruby/Gemfile
all:: $(T)aoc $(T)node $(T)faspex5 $(T)server $(T)faspex4
$(T)%: $(IS_OK)
	name='$@' && bundle exec $(SRC)$${name#$(T)}.rb $(SAMPLE_FILE)
	@touch $@
$(IS_OK): $(DIR_TOP)$(IS_OK)
	bundle install --gemfile=$(GEMFILE)
	bundle install
	@touch $@
clean::
	rm -f Gemfile.lock
