class Program
{
    static void Main(string[] args)
    {
        var fileList = args;
        if (fileList.Length <= 1)
        {
            throw new Exception($"ERROR: Usage: Prog <test name> <files to send>");
        }
        string[] files = fileList.Skip(1).ToArray();
        switch (args[0])
        {
            case "aoc":
                SampleAoc.start(files);
                break;
            case "faspex5":
                SampleFaspex5.start(files);
                break;
             default:
                throw new System.Exception("Unknown sample: " + args[0]);
        }
    }
}
