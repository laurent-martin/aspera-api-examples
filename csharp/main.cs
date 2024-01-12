class Program
{
    static void Main(string[] args)
    {
        var fileList = args;
        if (fileList.Length <= 0)
        {
            throw new Exception($"ERROR: Usage: Prog <test name> <files to send>");
        }
        switch (args[0])
        {
            case "aoc":
                SampleAoc.start();
                break;
            case "faspex5":
                SampleFaspex5.start();
                break;
             default:
                throw new System.Exception("Unknown sample: " + args[0]);
        }
    }
}
