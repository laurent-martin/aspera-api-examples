/// <summary>
/// Interface of the samples.
/// </summary>
interface SampleInterface
{
    /// <summary>
    /// Execute the sample.
    /// </summary>
    /// <param name="files">files to transfer</param>
    void start(string[] files);
}
/// <summary>
/// Execute a sample, by name.
/// </summary>
class Program
{
    /// <summary>
    /// Execute a sample, by name.
    /// </summary>
    /// <param name="args">name of the sample, e.g. <c>faspex5</c>, and files to transfer</param>
    static void Main(string[] args)
    {
        if (args.Length <= 1)
        {
            throw new Exception("Missing arguments: sample name and files to transfer");
        }
        var capitalized_name = new System.Text.StringBuilder();
        foreach (string word in args[0].Split('_'))
        {
            if (!string.IsNullOrEmpty(word))
            {
                capitalized_name.Append(System.Globalization.CultureInfo.CurrentCulture.TextInfo.ToTitleCase(word));
            }
        }
        // call the sample class, based on name, keeping remaining args
        Type sampleType = Type.GetType(capitalized_name.ToString(), throwOnError: true)!;
        ((SampleInterface)Activator.CreateInstance(sampleType)!).start(args.Skip(1).ToArray());
    }
}
