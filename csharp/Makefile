DIR_TOP=$(shell pwd -P)/../
include $(DIR_TOP)common.make
TSTFILE='faux:///test1?1k'
all:: $(T)server $(T)faspex5 $(T)aoc
$(T)%: $(IS_OK)
	@echo "Running test $@"
	name='$@' && dotnet run $${name#$(T)} $(TSTFILE)
	sleep 2
	@touch $@
# ensure SDK is there
../$(IS_OK):
	cd .. && make
$(IS_OK): ../$(IS_OK)
	cp ../generated/trsdk/noarch/connectors/csharp/TransferService/*.cs .
	@touch $@
do:
	dotnet build
clean: clean_flags
	dotnet clean
	rm -fr dist obj bin
