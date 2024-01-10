class Program
{
    static void Main(string[] args)
    {
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
