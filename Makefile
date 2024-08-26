# main folder (location of this makefile)
DIR_TOP=$(CURDIR)/
include $(DIR_TOP)common.mak
SECTIONS=cpp csharp java js python ruby web
template:
	cd doc && make
all clean superclean::
	set -ex && for sec in $(SECTIONS); do (cd $$sec && make $@); done
clean::
	find . -name \*.log -exec rm {} \;
	-killall asperatransferd
