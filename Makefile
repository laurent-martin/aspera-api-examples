# main folder (location of this makefile)
DIR_TOP=$(CURDIR)/
# the bulk of rules are in common.mak
include $(DIR_TOP)common.mak
SECTIONS=app/csharp app/go app/java app/js app/python app/ruby app/rust app/cpp web/javascript-html
.PHONY: cleantmp template sdk
template:
	cd doc && make
all clean superclean clean_flags:: .checked_env
	set -ex && for sec in $(SECTIONS); do make --directory=$$sec $@; done
clean::
	find . -name \*.log -exec rm {} \;
superclean:: cleantmp
	rm -f .checked_env
cleantmp:
	rm -fr $(GBL_DIR_TMP)
sdk: $(SDK_FILES_REQUIRED)
.checked_env:
	make -v|grep GNU
	touch $@
