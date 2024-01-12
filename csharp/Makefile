.PHONY: sample.cs

all: run
Transfer.cs TransferGrpc.cs:
	cp ../generated/trsdk/noarch/connectors/csharp/TransferService/*.cs .
run: Transfer.cs TransferGrpc.cs
	dotnet run faspex5
	dotnet run aoc
do:
	dotnet build
clean::
	dotnet clean
	rm -fr dist obj bin
