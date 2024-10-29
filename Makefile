# main folder (location of this makefile)
DIR_TOP=$(CURDIR)/
# the bulk of rules are in common.mak
include $(DIR_TOP)common.mak
SECTIONS=app/cpp app/csharp app/go app/java app/js app/python app/ruby app/rust web
.PHONY: cleantmp template sdk
template:
	cd doc && make
all clean superclean clean_flags::
	set -ex && for sec in $(SECTIONS); do (cd $$sec && make $@); done
clean::
	find . -name \*.log -exec rm {} \;
superclean:: cleantmp
cleantmp:
	rm -fr $(GBL_DIR_TMP)
sdk: $(SDK_FILES_REQUIRED)
