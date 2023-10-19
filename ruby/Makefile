# run make in upper folder to generate this file
include ../config.mak

SRC=src
RBTMP=$(CONFIG_TMPDIR)/rubytst/
RUBY_CONNECTORS=$(CONFIG_TRSDK_DIR_GENERIC)/connectors/ruby
GEMFILE=$(CONFIG_TRSDK_DIR_GENERIC)/connectors/ruby/Gemfile

export CONFIG_TRSDK_DIR_GENERIC

all: aoc.test node.test faspex5.test server.test faspex4.test
%.test: .is_installed_tmp .is_installed_libs
	bundle exec $(SRC)/$$(basename $@ .test).rb $(CONFIG_YAML) $(RBTMP)This_is_a_test.txt
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
	rm -f .is_installed_libs .is_installed_tmp .*.test
	rm -fr $(RBTMP)
	rm -f Gemfile.lock
