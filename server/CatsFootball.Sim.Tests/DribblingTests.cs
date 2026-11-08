using System.Text.Json;
using CatsFootball.Sim;

namespace CatsFootball.Sim.Tests;

public sealed class DribblingTests
{
    private static Balance Config => Balance.Load(Path.Combine(AppContext.BaseDirectory,"shared","football.json")).Value;
    [Fact] public void SharedTurnFixturesHoldThenTransferBeforeRunning()
    {
        using var file=JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory,"shared","test-vectors","dribbling.json")));
        foreach(var row in file.RootElement.EnumerateArray()){
            var state=new DribbleState();state.Reset(row.GetProperty("direction").Deserialize<Vec>(Balance.JsonOptions));
            var move=row.GetProperty("move").Deserialize<Vec>(Balance.JsonOptions);var planted=false;
            for(var tick=1;tick<=row.GetProperty("steps").GetInt32();tick++)planted=Dribbling.Step(state,move,tick,Config);
            var expected=row.GetProperty("expected");Assert.Equal(expected.GetProperty("planted").GetBoolean(),planted);
            Assert.Equal(expected.GetProperty("x").GetDouble(),state.Direction.X,9);Assert.Equal(expected.GetProperty("y").GetDouble(),state.Direction.Y,9);
        }
    }
    [Fact] public void ChangingTargetLateNeverSnapsAndNeutralCancelsWithoutTurning()
    {
        var state=new DribbleState();state.Reset(new(1,0));
        for(var tick=1;tick<=50;tick++){
            var previous=state.Direction;var move=tick<20?new Vec(-1,0):new Vec(0,-1);
            Dribbling.Step(state,move,tick,Config);
            Assert.InRange(Math.Abs(Dribbling.Angle(previous,state.Direction)),0,Math.PI/9+1e-8);
        }
        var before=state.Direction;Dribbling.Step(state,new(1,0),51,Config);Dribbling.Step(state,default,52,Config);
        Assert.Equal(before,state.Direction);Assert.Equal(0,state.TurnEndTick);
    }
    [Fact] public void AlternatingInputCannotSkipTheHold()
    {
        var state=new DribbleState();state.Reset(new(1,0));
        for(var tick=1;tick<=120;tick++){
            Dribbling.Step(state,new(tick%2==0?1:-1,0),tick,Config);
            Assert.Equal(new Vec(1,0),state.Direction);
        }
    }
}
