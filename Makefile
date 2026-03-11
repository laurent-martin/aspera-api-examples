# main folder (location of this makefile)
DIR_TOP=$(CURDIR)/
# the bulk of rules are in common.mak
include $(DIR_TOP)common.mak
SECTIONS=app/csharp app/go app/java app/js app/python app/ruby app/rust app/cpp web
.PHONY: cleantmp template sdk
template:
	cd doc && make
all clean clobber clean_flags:: .checked_env
	set -ex && for sec in $(SECTIONS); do make --directory=$$sec $@; done
# Delete intermediate files
clean::
	find . -name \*.log -exec rm {} \;
	rm -f aspera-api-examples.sln
# Restore in pristine state
clobber:: clean cleantmp
	rm -f .checked_env
	rm -fr build
cleantmp:
	rm -fr $(GBL_DIR_TMP)
sdk: $(SDK_FILES_REQUIRED)
.checked_env:
	make -v|grep GNU
	touch $@
