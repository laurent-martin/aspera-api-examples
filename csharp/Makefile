DIR_TOP=$(shell pwd -P)/../
include $(DIR_TOP)common.mak
all:: $(T)server_upload $(T)faspex5 $(T)aoc
$(T)%: $(IS_OK) $(SAMPLE_FILE)
	@echo "Running test $@"
	name='$@' && dotnet run $${name#$(T)} $(SAMPLE_FILE)
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
