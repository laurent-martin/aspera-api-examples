# main folder (location of this makefile)
DIR_TOP=$(shell pwd -P)/
include $(DIR_TOP)common.mak
SECTIONS=js python java ruby csharp cpp web
template:
	cd doc && make
all clean superclean::
	for sec in $(SECTIONS); do (cd $$sec && make $@); done
clean::
	find . -name \*.log -exec rm {} \;
	-killall asperatransferd
