# main folder (location of this makefile)
DIR_TOP=$(CURDIR)/
# the bulk of rules are in common.mak
include $(DIR_TOP)common.mak
SECTIONS=cpp csharp go java js python ruby rust web
.PHONY: cleantmp template
template:
	cd doc && make
all clean superclean clean_flags::
	set -ex && for sec in $(SECTIONS); do cd $$sec; make $@; cd ..; done
clean::
	find . -name \*.log -exec rm {} \;
superclean:: cleantmp
cleantmp:
	rm -fr $(GBL_DIR_TMP)
