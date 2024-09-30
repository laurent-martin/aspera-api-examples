/// <summary>
/// Interface for sample classes
/// </summary>
interface SampleInterface
{
    void start(string[] files);
}
class Program
{
    static void Main(string[] args)
    {
        if (args.Length <= 1)
        {
            throw new Exception($"ERROR: Usage: Prog <test name> <files to send>");
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
        ((SampleInterface)Activator.CreateInstance(Type.GetType(capitalized_name.ToString(), throwOnError: true))).start(args.Skip(1).ToArray());
    }
}
