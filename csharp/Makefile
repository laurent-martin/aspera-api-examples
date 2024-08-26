DIR_TOP=$(shell pwd -P)/../
include $(DIR_TOP)common.mak
TSTFILE='faux:///test1?1k'
all:: $(T)server_upload $(T)faspex5 $(T)aoc
$(T)%: $(IS_OK)
	@echo "Running test $@"
	name='$@' && dotnet run $${name#$(T)} $(TSTFILE)
	sleep 2
	@touch $@
$(IS_OK): $(DIR_TOP)$(IS_OK)
	@touch $@
do:
	dotnet build
clean::
	dotnet clean
superclean::
	rm -fr dist obj bin
