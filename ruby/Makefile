DIR_TOP=../
include $(DIR_TOP)/common.make
SRC=src/
RBTMP=$(TMPDIR)/rubytst/
TSTFILE=$(RBTMP)This_is_a_test.txt
GEMFILE=$(GLOBAL_TRSDK_NOARCH)/connectors/ruby/Gemfile
all:: $(T)aoc $(T)node $(T)faspex5 $(T)server $(T)faspex4
$(T)%: $(IS_OK)
	name='$@' && bundle exec $(SRC)$${name#$(T)}.rb $(TSTFILE)
	@touch $@
# ensure SDK is there
../$(IS_OK):
	cd .. && make
$(IS_OK): ../$(IS_OK)
	bundle install --gemfile=$(GEMFILE)
	bundle install
	mkdir -p $(RBTMP)
	date > $(TSTFILE)
	dd of=$(RBTMP)1G.bin bs=1k seek=$$((1024*1024)) count=0
	@touch $@
clean: clean_flags
	rm -fr $(RBTMP)
	rm -f Gemfile.lock
