using Microsoft.EntityFrameworkCore;

public class Init
{
    public void Up(DbContextOptionsBuilder options) => options.UseSqlite("DataSource=mig.db");
}
