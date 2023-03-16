# run make in upper folder to generate this file
include ../config.mak

SRC=src
TMPDIR=$(CONFIG_TMPDIR)rubytst/
RUBY_CONNECTORS=$(CONFIG_TRSDK_DIR_GENERIC)/connectors/ruby
GEMFILE=$(CONFIG_TRSDK_DIR_GENERIC)/connectors/ruby/Gemfile

export CONFIG_TRSDK_DIR_GENERIC

all: faspex
faspex: .test_env
	$(SRC)/faspex5.rb $(CONFIG_YAML) $(TMPDIR)This_is_a_test.txt
$(GEMFILE):
	@echo "run make in upper folder to install transfer SDK"
	exit 1
.test_env: .is_installed_tmp .is_installed_libs
tmp: .is_installed_tmp
.is_installed_tmp:
	mkdir -p $(TMPDIR)
	date > $(TMPDIR)This_is_a_test.txt
	dd of=$(TMPDIR)1G.bin bs=1k seek=$$((1024*1024)) count=0
	touch $@
libs: .is_installed_libs
.is_installed_libs: $(GEMFILE)
	bundle install --gemfile=$(GEMFILE)
	bundle install
	touch $@
# TODO: remove when transfersdk fixed: the "ln -s" is because of bug in transfer sdk: it requires "etc" even if property "etc" is set in config file
clean:
	rm -f .is_installed_libs .is_installed_tmp
	rm -fr $(TMPDIR)
