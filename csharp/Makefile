.PHONY: sample.cs

all: run
Transfer.cs TransferGrpc.cs:
	cp ../generated/trsdk/noarch/connectors/csharp/TransferService/*.cs .
run: Transfer.cs TransferGrpc.cs
	dotnet run faspex5 'faux:///test1?1k'
	dotnet run aoc 'faux:///test1?1k'
do:
	dotnet build
clean::
	dotnet clean
	rm -fr dist obj bin
