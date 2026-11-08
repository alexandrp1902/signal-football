using CatsFootball.Sim;

namespace CatsFootball.Sim.Tests;

public sealed class FootballTests
{
    private static Balance Config => Balance.Load(Path.Combine(AppContext.BaseDirectory,"shared","football.json")).Value;
    private sealed class Control { public int Seq, Action; public Vec Move, Aim = new(0,1); public bool Held; public ActionTransition[] Events = []; }
    private sealed class Game
    {
        public FootballWorld World { get; } = new(Config);
        private readonly Dictionary<string,Control> _input = [];
        public int Tick { get; private set; }
        public SoccerPlayer Add(string id, string team, double x, double y)
        {var p=new SoccerPlayer(id,team,0){Position=new(x,y)};World.Players.Add(p);_input[id]=new();return p;}
        public void Move(SoccerPlayer p, Vec direction) {_input[p.Id].Move=direction.Clamped;_input[p.Id].Aim=direction.Length>0?direction.Unit:_input[p.Id].Aim;}
        public void Aim(SoccerPlayer p, Vec direction) => _input[p.Id].Aim=direction.Unit;
        public void Begin(SoccerPlayer p, Vec direction)
        {var c=_input[p.Id];c.Aim=direction.Unit;c.Held=true;c.Events=[new("begin",++c.Action,World.Ball.OwnerId==p.Id?"kick":"tackle",World.Ball.PossessionVersion)];Step();}
        public void Release(SoccerPlayer p)
        {var c=_input[p.Id];c.Held=false;c.Events=[new("release",c.Action)];Step();}
        public void Step(int count=1)
        {
            for(var i=0;i<count;i++){
                Tick++;
                foreach(var p in World.Players){var c=_input[p.Id];p.Input.Enqueue([new(++c.Seq,Tick,c.Move.X,c.Move.Y,c.Aim.X,c.Aim.Y,c.Held,c.Events)],Tick,Tick*1000.0/60);c.Events=[];}
                World.Step(Tick,Tick*1000.0/60);
            }
        }
        public void Give(SoccerPlayer p, Vec direction)
        {Aim(p,direction);p.Motion.FacingX=direction.Unit.X;p.Motion.FacingY=direction.Unit.Y;p.Dribble.Reset(direction);World.Ball.OwnerId=p.Id;World.Ball.State="controlled";World.Ball.PossessionVersion++;World.Ball.Position=p.Position+direction.Unit*Config.DribbleDistance;}
    }

    [Fact] public void CarryFollowsMovementWhileAimRemainsIndependentAndSpeedIsNinetyPercent()
    {
        var g=new Game();var p=g.Add("a","blue",-4,0);g.Give(p,new(1,0));g.Move(p,new(1,0));g.Aim(p,new(0,1));g.Step(60);
        Assert.Equal(Config.RunSpeed*.9,p.Velocity.Length,10);Assert.Equal(1,p.Motion.FacingY,10);
        Assert.Equal(Config.DribbleDistance,g.World.Ball.Position.X-p.Position.X,9);Assert.Equal(p.Position.Y,g.World.Ball.Position.Y,9);
    }
    [Fact] public void ReversalPlantsFeetAndBallStaysOnOldSideBeforeMovingAroundTheCat()
    {
        var g=new Game();var p=g.Add("a","blue",-4,0);g.Give(p,new(1,0));g.Move(p,new(1,0));g.Step(20);
        var start=p.Position;g.Move(p,new(-1,0));g.Step(12);
        Assert.Equal(start,p.Position);Assert.Equal(default,p.Velocity);Assert.Equal(start.X+Config.DribbleDistance,g.World.Ball.Position.X,9);
        g.Step();Assert.Equal(start,p.Position);Assert.True(g.World.Ball.Position.Y>start.Y+.3);
        g.Step(8);Assert.Equal(start,p.Position);Assert.Equal(start.X-Config.DribbleDistance,g.World.Ball.Position.X,9);
        Assert.Equal(p.Id,g.World.Ball.OwnerId);g.Step();Assert.True(p.Position.X<start.X);
    }
    [Fact] public void CapturingBallImmediatelyLimitsExistingSprintSpeed()
    {
        var g=new Game();var p=g.Add("a","blue",-2,0);p.Velocity=new(Config.RunSpeed,0);g.Move(p,new(1,0));
        for(var i=0;i<60&&g.World.Ball.OwnerId is null;i++)g.Step();
        Assert.Equal(p.Id,g.World.Ball.OwnerId);Assert.InRange(p.Velocity.Length,0,Config.RunSpeed*.9+1e-9);
    }
    [Theory] [InlineData(-1,0)] [InlineData(0,1)] [InlineData(0,-1)] [InlineData(-1,1)]
    public void ShotAlwaysFollowsArrowEvenWhenRunningWithBallOnAnotherSide(double x,double y)
    {
        var g=new Game();var p=g.Add("a","blue",-4,0);g.Give(p,new(1,0));g.Move(p,new(1,0));g.Step(20);
        var direction=new Vec(x,y).Unit;g.Begin(p,direction);g.Step(20);g.Release(p);
        Assert.Equal(1,g.World.Ball.ImpulseSeq);Assert.Equal("kicked",g.World.Ball.State);
        Assert.Equal(direction.X,g.World.Ball.Velocity.Unit.X,9);Assert.Equal(direction.Y,g.World.Ball.Velocity.Unit.Y,9);
        g.Step(12);Assert.Equal(direction.X,g.World.Ball.Velocity.Unit.X,9);Assert.Equal(direction.Y,g.World.Ball.Velocity.Unit.Y,9);
    }
    [Fact] public void ShotTransferCannotTeleportThroughAnOpponent()
    {
        var g=new Game();var p=g.Add("a","blue",0,0);g.Add("b","red",0,1.2);g.Give(p,new(1,0));
        g.Begin(p,new(0,1));g.Step(20);g.Release(p);
        // Obstructed transfer stays at the original x; the ball still launches north.
        Assert.Equal(1.1,g.World.Ball.Position.X,8);Assert.True(g.World.Ball.Velocity.Y>0);Assert.Equal(0,g.World.Ball.Velocity.X,8);
    }
    [Fact] public void ObstructedReverseShotCanClearItsShooterWithoutBouncingBack()
    {
        var g=new Game();var p=g.Add("a","blue",0,0);g.Add("b","red",-1.5,.65);g.Give(p,new(1,0));
        g.Begin(p,new(-1,0));g.Release(p);
        Assert.True(g.World.Ball.Position.X>0); // Opponent blocked transfer to the aimed foot.
        g.Step(12);Assert.True(g.World.Ball.Position.X<0);Assert.True(g.World.Ball.Velocity.X<0);Assert.Equal(0,g.World.Ball.Velocity.Y,9);
    }
    [Fact] public void StandingPlayerCannotBePushedAndMovingBodyDoesNotPassThrough()
    {
        var g=new Game();var a=g.Add("a","blue",-2,0);var b=g.Add("b","red",0,0);g.World.Ball.Position=new(8,8);g.Move(a,new(1,0));g.Step(240);
        Assert.Equal(0,b.Motion.X,10);Assert.Equal(0,b.Motion.Y,10);Assert.InRange(a.Motion.X,-.841,-.839);Assert.InRange((a.Position-b.Position).Length,.84-1e-6,1);
    }
    [Fact] public void TwoMovingBodiesStopSymmetricallyAndCanSlideAlongContact()
    {
        var g=new Game();var a=g.Add("a","blue",-2,0);var b=g.Add("b","red",2,0);g.World.Ball.Position=new(8,8);g.Move(a,new(1,0));g.Move(b,new(-1,0));g.Step(120);
        Assert.Equal(-a.Motion.X,b.Motion.X,8);Assert.InRange((a.Position-b.Position).Length,.84-1e-6,.841);
        g.Move(b,default);g.Move(a,new(1,1));g.Step(45);Assert.True(a.Motion.Y>1);Assert.Equal(0,b.Motion.Y,8);
    }
    [Fact] public void SixPlayersConvergeWithoutOverlapping()
    {
        var g=new Game();g.World.Ball.Position=new(10,10);
        for(var i=0;i<6;i++){var angle=i*Math.PI/3;var p=g.Add($"p{i}",i%2==0?"blue":"red",Math.Cos(angle)*3,Math.Sin(angle)*3);g.Move(p,p.Position*-1);}
        for(var tick=0;tick<180;tick++){g.Step();for(var i=0;i<6;i++)for(var j=i+1;j<6;j++)Assert.True((g.World.Players[i].Position-g.World.Players[j].Position).Length>=.84-1e-5);}
    }
    [Fact] public void SoloPlayerCapturesAndCanChargeAndKickExactlyOnce()
    {
        var g=new Game();var p=g.Add("a","blue",0,-2.5);g.Move(p,new(0,1));
        for(var i=0;i<90&&g.World.Ball.OwnerId is null;i++)g.Step();
        Assert.Equal(p.Id,g.World.Ball.OwnerId);g.Move(p,default);g.Begin(p,new(0,1));g.Step(60);g.Release(p);
        Assert.Null(g.World.Ball.OwnerId);Assert.Equal("kicked",g.World.Ball.State);Assert.InRange(g.World.Ball.Velocity.Length,23,24);Assert.Equal(1,g.World.Ball.ImpulseSeq);
        g.Release(p);Assert.Equal(1,g.World.Ball.ImpulseSeq);Assert.Equal(0,p.SlideRemaining);
    }
    [Theory] [InlineData(0)] [InlineData(18)] [InlineData(36)]
    public void TackleTravelsTwentyPercentFartherBySlidingLongerAtTheSameSpeed(int heldTicks)
    {
        var g=new Game();var p=g.Add("a","blue",-5,0);g.World.Ball.Position=new(8,8);g.Begin(p,new(1,0));g.Step(heldTicks);
        var startTick=g.Tick;g.Release(p);
        var charge=Math.Clamp((heldTicks+1)/60.0/Config.TackleChargeSeconds,0,1);
        var expectedRange=(1.8+(3.2-1.8)*charge)*1.2;
        Assert.Equal(13,p.Velocity.Length,8);
        for(var i=0;i<30&&p.Sliding;i++)g.Step();
        Assert.False(p.Sliding);Assert.Equal(-5+expectedRange,p.Motion.X,8);
        Assert.Equal((int)Math.Ceiling(expectedRange/13*60),g.Tick-startTick);
        Assert.True(p.RecoverEndTick>g.Tick);Assert.True(p.CooldownEndTick>g.Tick);
        var position=p.Position;g.Move(p,new(1,0));g.Step(5);Assert.Equal(position,p.Position);
    }
    [Theory]
    [InlineData(false,false)] [InlineData(false,true)] [InlineData(true,false)]
    public void BodyBlocksTackleWithoutKnockbackOrLosingProtectedBall(bool ally,bool ballBehind)
    {
        var g=new Game();var a=g.Add("a","blue",-3,0);var b=g.Add("b",ally?"blue":"red",0,0);
        g.Give(b,new(1,0));if(!ballBehind)g.World.Ball.Position=new(0,1.1);
        g.Begin(a,new(1,0));g.Step(36);g.Release(a);g.Step(24);
        Assert.Equal(0,b.Motion.X,10);Assert.Equal(0,b.Motion.Y,10);Assert.False(a.Sliding);Assert.Equal(b.Id,g.World.Ball.OwnerId);Assert.Equal(0,g.World.Ball.ImpulseSeq);
        Assert.InRange((a.Position-b.Position).Length,.84-1e-6,.841);
    }
    [Fact] public void OpenBallCanBeTackledBeforeTheBodyStopsTheSlide()
    {
        var g=new Game();var a=g.Add("a","blue",-3,0);var b=g.Add("b","red",0,0);g.Give(b,new(-1,0));g.Begin(a,new(1,0));g.Step(36);g.Release(a);
        for(var i=0;i<20&&g.World.Ball.ImpulseSeq==0;i++)g.Step();
        Assert.Equal(1,g.World.Ball.ImpulseSeq);Assert.Null(g.World.Ball.OwnerId);Assert.True(g.World.Ball.Velocity.X>0);Assert.Equal(0,b.Motion.X,10);
        g.Step(20);Assert.Equal(1,g.World.Ball.ImpulseSeq);Assert.False(a.Sliding);
    }
    [Fact] public void SimultaneousTacklesStopBothBodies()
    {
        var g=new Game();var a=g.Add("a","blue",-1,0);var b=g.Add("b","red",1,0);g.World.Ball.Position=new(8,8);
        a.Sliding=b.Sliding=true;a.SlideRemaining=b.SlideRemaining=3.2;a.SlideDirection=new(1,0);b.SlideDirection=new(-1,0);a.CooldownEndTick=b.CooldownEndTick=90;
        g.Step(10);Assert.False(a.Sliding);Assert.False(b.Sliding);Assert.InRange((a.Position-b.Position).Length,.84-1e-6,.841);Assert.Equal(0,a.Motion.Y);Assert.Equal(0,b.Motion.Y);
    }
    [Fact] public void SideTackleReachesAnOpenBallWithoutHittingItsOwner()
    {
        var g=new Game();var a=g.Add("a","blue",-1.1,-3);var b=g.Add("b","red",0,0);g.Give(b,new(-1,0));
        g.Begin(a,new(0,1));g.Step(36);g.Release(a);
        for(var i=0;i<20&&g.World.Ball.ImpulseSeq==0;i++)g.Step();
        Assert.Equal(1,g.World.Ball.ImpulseSeq);Assert.Null(g.World.Ball.OwnerId);Assert.True(g.World.Ball.Velocity.Y>0);Assert.Equal(default,b.Position);
    }
    [Fact] public void TackleStopsAtWallAndDoesNotRestartFromHeldGesture()
    {
        var g=new Game();var p=g.Add("a","blue",Config.FieldWidth/2-1,0);g.World.Ball.Position=new(8,8);g.Begin(p,new(1,0));g.Step(36);g.Release(p);g.Step(12);
        Assert.False(p.Sliding);Assert.Equal(Config.FieldWidth/2-Config.PlayerRadius,p.Motion.X,8);Assert.True(p.CooldownEndTick>g.Tick);
    }
    [Fact] public void PossessionChangeCancelsShotAndCannotTurnItIntoTackle()
    {
        var g=new Game();var p=g.Add("a","blue",0,0);g.Give(p,new(0,1));g.Begin(p,new(0,1));g.Step(15);
        g.World.Ball.PossessionVersion++;g.World.Ball.OwnerId=null;g.World.Ball.State="free";g.World.Ball.Position=new(8,8);g.Release(p);
        Assert.Equal(0,g.World.Ball.ImpulseSeq);Assert.False(p.Sliding);Assert.Equal("",p.PreparingMode);
    }
    [Fact] public void FastBallCannotTunnelThroughBodyOrPost()
    {
        var g=new Game();g.Add("a","blue",0,0);g.World.Ball.Position=new(-2,0);g.World.Ball.Velocity=new(240,0);g.Step();
        Assert.True(g.World.Ball.Velocity.X<0);Assert.True(g.World.Ball.Position.X<-.76);
        var post=new Game();post.World.Ball.Position=new(Config.GoalWidth/2,Config.FieldHeight/2-.6);post.World.Ball.Velocity=new(0,24);post.Step();
        Assert.True(post.World.Ball.Velocity.Y<0);Assert.Equal(0,post.World.BlueScore);
    }
    [Fact] public void DribblingCannotPullBallThroughWall()
    {
        var g=new Game();var p=g.Add("a","blue",Config.FieldWidth/2-1.7,0);g.Give(p,new(1,0));g.Move(p,new(1,0));g.Step(120);
        var bound=Config.FieldWidth/2-Config.BallRadius;Assert.InRange(g.World.Ball.Position.X,-bound-1e-5,bound+1e-5);Assert.Null(g.World.Ball.OwnerId);
    }
    [Theory] [InlineData(1)] [InlineData(-1)]
    public void FullBallCrossingScoresOnceInEitherDirection(int side)
    {
        var g=new Game();g.World.Ball.Position=new(0,side*(Config.FieldHeight/2+.2));g.World.Ball.Velocity=new(0,side*24);g.Step(20);
        Assert.Equal(side>0?1:0,g.World.BlueScore);Assert.Equal(side<0?1:0,g.World.RedScore);Assert.Equal("goalPause",g.World.Phase);
    }
    [Theory] [InlineData(false)] [InlineData(true)]
    public void GoalAtDeadlineCountsButGoalAfterDeadlineDoesNot(bool late)
    {
        var b=Config with{MatchSeconds=1.0/60};var world=new FootballWorld(b);world.BeginMatch(0);world.Step(180,0);
        var speed=24*Math.Exp(-b.BallDrag/60);world.Ball.Position=new(0,b.FieldHeight/2+b.BallRadius-speed/60-(late?.01:0));world.Ball.Velocity=new(0,24);world.Step(240,0);
        Assert.Equal(late?0:1,world.BlueScore);Assert.Equal("finished",world.Phase);
    }
    [Fact] public void CompleteActiveTimerFinishesAndPracticeResetsTheMatch()
    {
        var world=new FootballWorld(Config);world.BeginMatch(0);world.Step(180,0);
        for(var tick=240;tick<11042;tick++)world.Step(tick,0);
        Assert.Equal("finished",world.Phase);Assert.Equal(0,world.RemainingSeconds);
        world.Practice(11043);Assert.Equal("training",world.Phase);Assert.Equal(default,world.Ball.Position);Assert.Null(world.Ball.OwnerId);
    }
    [Fact] public void CoincidentBodiesAreSeparatedDeterministicallyAndSpawnsAreFree()
    {
        var g=new Game();var a=g.Add("a","blue",0,0);var b=g.Add("b","red",0,0);g.Step();
        Assert.InRange((a.Position-b.Position).Length,.84-1e-7,1);Assert.True(a.Motion.X<b.Motion.X);
        var c=g.Add("c","red",b.Motion.X,b.Motion.Y);g.World.PlaceSafely(c);Assert.True((c.Position-b.Position).Length>=.84);
    }
    [Fact] public void ANewInputEpochCanUseActionOneAgain()
    {
        var p=new SoccerPlayer("a","blue",0){LastActionId=1,PreparedActionId=1};p.ResetInput(100);Assert.Equal(0,p.LastActionId);Assert.Equal(0,p.PreparedActionId);
    }
}
