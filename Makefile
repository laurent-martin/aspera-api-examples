# main folder (location of this makefile)
DIR_TOP=$(CURDIR)/
include $(DIR_TOP)common.mak
SECTIONS=cpp csharp java js python ruby web
.PHONY: cleantmp template
template:
	cd doc && make
all clean superclean clean_flags::
	set -ex && for sec in $(SECTIONS); do (killall -q asperatransferd||:; set -ex; cd $$sec; make $@); done
clean::
	find . -name \*.log -exec rm {} \;
	-killall -q asperatransferd
superclean:: cleantmp
cleantmp:
	rm -fr $(GBL_DIR_TMP)
