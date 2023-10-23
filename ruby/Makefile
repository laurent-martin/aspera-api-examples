DIR_TOP=../
include $(DIR_TOP)/common.make
SRC=src
RBTMP=$(TMPDIR)/rubytst/
RUBY_CONNECTORS=$(GLOBAL_TRSDK_NOARCH)/connectors/ruby
GEMFILE=$(GLOBAL_TRSDK_NOARCH)/connectors/ruby/Gemfile
all: aoc$(T) node$(T) faspex5$(T) server$(T) faspex4$(T)
%$(T): .is_installed_tmp .is_installed_libs
	bundle exec $(SRC)/$$(basename $@ $(T)).rb $(RBTMP)This_is_a_test.txt
	touch $@
$(GEMFILE):
	@echo "run make in upper folder to install transfer SDK"
	exit 1
tmp: .is_installed_tmp
.is_installed_tmp:
	mkdir -p $(RBTMP)
	date > $(RBTMP)This_is_a_test.txt
	dd of=$(RBTMP)1G.bin bs=1k seek=$$((1024*1024)) count=0
	touch $@
libs: .is_installed_libs
.is_installed_libs: $(GEMFILE)
	bundle install --gemfile=$(GEMFILE)
	bundle install
	touch $@
# TODO: remove when transfersdk fixed: the "ln -s" is because of bug in transfer sdk: it requires "etc" even if property "etc" is set in config file
clean:
	rm -f .is_installed_libs .is_installed_tmp
	test -n "$(T)" && rm -f *$(T)
	rm -fr $(RBTMP)
	rm -f Gemfile.lock
